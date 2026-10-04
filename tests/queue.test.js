import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import { TaskQueue } from '../src/queue.js';

describe('TaskQueue', () => {
    test('executes tasks in priority order and FIFO within same priority', async () => {
        const queue = new TaskQueue({ concurrency: 1 });
        const results = [];

        let releaseInitialTask;
        const initialTaskPromise = new Promise(resolve => { releaseInitialTask = resolve; });

        queue.push(async () => {
            await initialTaskPromise;
            results.push('initial');
        }, { priority: 'normal' });

        queue.push(async () => { await setTimeout(5); results.push('low1'); }, { priority: 'low' });
        queue.push(async () => { await setTimeout(5); results.push('normal1'); }, { priority: 'normal' });
        queue.push(async () => { await setTimeout(5); results.push('high1'); }, { priority: 'high' });
        queue.push(async () => { await setTimeout(5); results.push('high2'); }, { priority: 'high' });
        queue.push(async () => { await setTimeout(5); results.push('normal2'); }, { priority: 'normal' });

        releaseInitialTask();
        await queue.drain();

        assert.deepEqual(results, ['initial', 'high1', 'high2', 'normal1', 'normal2', 'low1']);
    });

    test('respects concurrency limit', async () => {
        const queue = new TaskQueue({ concurrency: 2 });
        let active = 0;
        let maxActive = 0;

        const makeTask = () => async () => {
            active++;
            if (active > maxActive) maxActive = active;
            await setTimeout(20);
            active--;
        };

        queue.push(makeTask());
        queue.push(makeTask());
        queue.push(makeTask());
        queue.push(makeTask());

        await queue.drain();

        assert.equal(maxActive, 2);
    });

    test('retries with exponential backoff', async () => {
        const queue = new TaskQueue({ concurrency: 1, maxRetries: 2, initialBackoffMs: 10 });
        let attempts = 0;
        const start = Date.now();
        const times = [];

        queue.push(async () => {
            times.push(Date.now() - start);
            attempts++;
            if (attempts < 3) throw new Error('fail');
            return 'success';
        });

        await queue.drain();

        assert.equal(attempts, 3);
        const backoff1 = times[1] - times[0];
        const backoff2 = times[2] - times[1];
        // 1st backoff: 10ms * (2^0) = 10ms
        // 2nd backoff: 10ms * (2^1) = 20ms
        assert.ok(backoff1 >= 5, `Expected >= 5ms, got ${backoff1}`);
        assert.ok(backoff2 >= 15, `Expected >= 15ms, got ${backoff2}`);
    });

    test('moves to dead letter queue after max retries', async () => {
        const queue = new TaskQueue({ concurrency: 1, maxRetries: 1, initialBackoffMs: 5 });
        let attempts = 0;

        queue.push(async () => {
            attempts++;
            throw new Error('fail');
        });

        await queue.drain();

        assert.equal(attempts, 2);
        const dlq = queue.getDeadLetterQueue();
        assert.equal(dlq.length, 1);
        assert.equal(dlq[0].error.message, 'fail');
    });

    test('clears and retries dead letter queue', async () => {
        const queue = new TaskQueue({ concurrency: 1, maxRetries: 0 });

        queue.push(async () => { throw new Error('fail'); });
        await queue.drain();

        let dlq = queue.getDeadLetterQueue();
        assert.equal(dlq.length, 1);

        queue.clearDeadLetterQueue();
        assert.equal(queue.getDeadLetterQueue().length, 0);

        let success = false;
        queue.push(async () => {
            if (!success) {
                success = true;
                throw new Error('fail2');
            }
            return 'recovered';
        });
        await queue.drain();

        dlq = queue.getDeadLetterQueue();
        assert.equal(dlq.length, 1);

        queue.retryDeadLetterQueue();
        assert.equal(queue.getDeadLetterQueue().length, 0);
        await queue.drain();

        assert.equal(queue.getDeadLetterQueue().length, 0);
    });

    test('emits lifecycle events', async () => {
        const queue = new TaskQueue({ concurrency: 1, maxRetries: 1, initialBackoffMs: 5 });
        const events = [];

        queue.on('task:queued', () => events.push('queued'));
        queue.on('task:started', () => events.push('started'));
        queue.on('task:completed', (result) => events.push(`completed:${result}`));
        queue.on('task:failed', () => events.push('failed'));
        queue.on('task:retry', () => events.push('retry'));
        queue.on('task:dlq', () => events.push('dlq'));

        queue.push(async () => 'ok');
        await queue.drain();

        assert.deepEqual(events, ['queued', 'started', 'completed:ok']);

        events.length = 0;
        let attempts = 0;
        queue.push(async () => {
            attempts++;
            throw new Error('err');
        });
        await queue.drain();

        assert.deepEqual(events, [
            'queued',
            'started',
            'failed',
            'retry',
            'started',
            'failed',
            'dlq'
        ]);
    });

    test('shutdown gracefully waits for in-flight tasks and cancels retries', async () => {
        const queue = new TaskQueue({ concurrency: 1, maxRetries: 1, initialBackoffMs: 50 });
        let executed = 0;
        let secondTaskExecuted = false;

        queue.push(async () => {
            await setTimeout(20);
            executed++;
        });

        queue.push(async () => {
            secondTaskExecuted = true;
        });

        // The task that will fail and retry
        queue.push(async () => {
            throw new Error('fail to retry');
        }, { priority: 'high' });

        await setTimeout(5); // give queue time to pick up high priority task

        const shutdownPromise = queue.shutdown();

        await assert.rejects(async () => {
            queue.push(async () => {});
        }, /Queue is shutting down/);

        await shutdownPromise;

        assert.equal(executed, 1); // in-flight task completed
        assert.equal(secondTaskExecuted, false); // queued task never started
    });

    test('shutdown forcefully does not wait for in-flight tasks', async () => {
        const queue = new TaskQueue({ concurrency: 1 });
        let executed = 0;

        queue.push(async () => {
            await setTimeout(50);
            executed++;
        });

        await setTimeout(10);

        await queue.shutdown({ force: true });

        assert.equal(executed, 0); // at the time shutdown resolves, task is still in-flight
    });

    test('drain resolves when all tasks finish', async () => {
        const queue = new TaskQueue({ concurrency: 2 });
        let total = 0;

        for (let i = 0; i < 5; i++) {
            queue.push(async () => {
                await setTimeout(10);
                total++;
            });
        }

        await queue.drain();
        assert.equal(total, 5);
    });
});

    test('queue does not stall while task is in retry backoff', async () => {
        const queue = new TaskQueue({ concurrency: 1, maxRetries: 1, initialBackoffMs: 20 });
        const results = [];

        queue.push(async () => {
            throw new Error('fail');
        });

        queue.push(async () => {
            results.push('second_task_completed');
        });

        await queue.drain();

        assert.deepEqual(results, ['second_task_completed']);
    });
