import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import { TaskQueue } from '../src/queue.js';

describe('TaskQueue Adversarial and Boundary Tests', () => {
    test('handles synchronous throws identically to asynchronous rejections', async () => {
        const queueSync = new TaskQueue({ concurrency: 1, maxRetries: 1, initialBackoffMs: 1 });
        const queueAsync = new TaskQueue({ concurrency: 1, maxRetries: 1, initialBackoffMs: 1 });

        queueSync.push(() => {
            throw new Error('sync err');
        });

        queueAsync.push(async () => {
            throw new Error('async err');
        });

        await Promise.all([queueSync.drain(), queueAsync.drain()]);

        const dlqSync = queueSync.getDeadLetterQueue();
        const dlqAsync = queueAsync.getDeadLetterQueue();

        assert.equal(dlqSync.length, 1);
        assert.equal(dlqSync[0].error.message, 'sync err');

        assert.equal(dlqAsync.length, 1);
        assert.equal(dlqAsync[0].error.message, 'async err');
    });

    test('handles rapid bursts of tasks under tight concurrency limits', async () => {
        const queue = new TaskQueue({ concurrency: 2 });
        let maxActive = 0;
        let active = 0;
        let completed = 0;
        const totalTasks = 100;

        for (let i = 0; i < totalTasks; i++) {
            queue.push(async () => {
                active++;
                if (active > maxActive) {
                    maxActive = active;
                }
                await new Promise(resolve => setImmediate(resolve));
                active--;
                completed++;
            });
        }

        await queue.drain();

        assert.equal(completed, totalTasks);
        assert.ok(maxActive <= 2, `Max active was ${maxActive}`);
    });

    test('drain waits for tasks that are pending retry', async () => {
        const queue = new TaskQueue({ concurrency: 1, maxRetries: 1, initialBackoffMs: 20 });
        let attempts = 0;
        queue.push(async () => {
            attempts++;
            if (attempts === 1) {
                throw new Error('first fail');
            }
        });

        const drainPromise = queue.drain();
        let resolved = false;
        drainPromise.then(() => { resolved = true; });

        await setTimeout(10);
        assert.equal(resolved, false);

        await drainPromise;
        assert.equal(resolved, true);
        assert.equal(attempts, 2);
    });

    test('shutdown during retry cancels timer and resolves shutdown', async () => {
        const queue = new TaskQueue({ concurrency: 1, maxRetries: 1, initialBackoffMs: 100 });
        let executed = 0;

        queue.push(async () => {
            executed++;
            throw new Error('retry please');
        });

        await setTimeout(20);

        await queue.shutdown();

        assert.equal(executed, 1);

        await setTimeout(150);
        assert.equal(executed, 1);
    });

    test('throws on invalid priority inputs', () => {
        const queue = new TaskQueue();

        assert.throws(() => {
            queue.push(async () => {}, { priority: 'super-high' });
        }, /Invalid priority/);

        assert.throws(() => {
            queue.push(async () => {}, { priority: 123 });
        }, /Invalid priority/);
    });

    test('event listener lifecycle verification', async () => {
        const queue = new TaskQueue({ concurrency: 1, maxRetries: 1, initialBackoffMs: 1 });
        const events = [];

        queue.on('task:queued', (item) => events.push(`queued:${item.priority}`));
        queue.on('task:started', (item) => events.push(`started:${item.attempt}`));
        queue.on('task:completed', (res) => events.push(`completed:${res}`));
        queue.on('task:failed', (err) => events.push(`failed:${err.message}`));
        queue.on('task:retry', (item) => events.push(`retry:${item.attempt}`));
        queue.on('task:dlq', (item) => events.push(`dlq:${item.attempt}`));

        queue.push(async () => 'success-result', { priority: 'high' });

        queue.push(async () => {
            throw new Error('fail-error');
        }, { priority: 'low' });

        await queue.drain();

        const expected = [
            'queued:high',
            'started:0',
            'queued:low',
            'completed:success-result',
            'started:0',
            'failed:fail-error',
            'retry:1',
            'started:1',
            'failed:fail-error',
            'dlq:1'
        ];

        assert.deepEqual(events, expected);
    });
});
