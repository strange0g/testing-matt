import { EventEmitter } from 'node:events';

export class TaskQueue extends EventEmitter {
    constructor(options = {}) {
        super();
        this.concurrency = options.concurrency || 1;
        this.maxRetries = options.maxRetries ?? 3;
        this.initialBackoffMs = options.initialBackoffMs || 50;

        this.queues = {
            high: [],
            normal: [],
            low: []
        };
        this.activeCount = 0;
        this.dlq = [];
        this.isShuttingDown = false;
        this.retryTimers = new Set();
        this.drainResolvers = new Set();
    }

    push(task, options = {}) {
        if (this.isShuttingDown) {
            throw new Error('Queue is shutting down');
        }

        const priority = options.priority || 'normal';
        if (!this.queues[priority]) {
            throw new Error('Invalid priority');
        }

        const taskItem = {
            task,
            priority,
            attempt: 0
        };

        this.queues[priority].push(taskItem);
        this.emit('task:queued', taskItem);

        this._processNext();
    }

    _processNext() {
        if (this.isShuttingDown || this.activeCount >= this.concurrency) {
            if (this.activeCount === 0 && !this._hasPendingTasks()) {
                this._resolveDrains();
            }
            return;
        }

        const nextTask = this._getNextTask();
        if (!nextTask) {
            if (this.activeCount === 0 && !this._hasPendingTasks()) {
                this._resolveDrains();
            }
            return;
        }

        this.activeCount++;
        this._executeTask(nextTask);
    }

    _getNextTask() {
        if (this.queues.high.length > 0) return this.queues.high.shift();
        if (this.queues.normal.length > 0) return this.queues.normal.shift();
        if (this.queues.low.length > 0) return this.queues.low.shift();
        return null;
    }

    _hasPendingTasks() {
        return this.queues.high.length > 0 || this.queues.normal.length > 0 || this.queues.low.length > 0 || this.retryTimers.size > 0;
    }

    async _executeTask(taskItem) {
        this.emit('task:started', taskItem);
        try {
            const result = await taskItem.task();
            this.emit('task:completed', result);
            this.activeCount--;
            this._processNext();
        } catch (error) {
            this.emit('task:failed', error);
            this._handleFailure(taskItem, error);
        }
    }

    _handleFailure(taskItem, error) {
        if (taskItem.attempt < this.maxRetries) {
            const backoffDelay = this.initialBackoffMs * (2 ** taskItem.attempt);
            taskItem.attempt++;
            this.emit('task:retry', taskItem);

            this.activeCount--;

            if (!this.isShuttingDown) {
                const timer = setTimeout(() => {
                    this.retryTimers.delete(timer);
                    if (!this.isShuttingDown) {
                        this.queues[taskItem.priority].push(taskItem);
                        this._processNext();
                    } else {
                        if (this.activeCount === 0 && !this._hasPendingTasks()) {
                            this._resolveDrains();
                        }
                    }
                }, backoffDelay);
                this.retryTimers.add(timer);
            }

            this._processNext(); // continue processing other tasks
        } else {
            taskItem.error = error;
            this.dlq.push(taskItem);
            this.emit('task:dlq', taskItem);
            this.activeCount--;
            this._processNext();
        }
    }

    getDeadLetterQueue() {
        return [...this.dlq];
    }

    clearDeadLetterQueue() {
        this.dlq = [];
    }

    retryDeadLetterQueue() {
        const tasksToRetry = this.dlq;
        this.dlq = [];
        for (const taskItem of tasksToRetry) {
            taskItem.attempt = 0;
            this.push(taskItem.task, { priority: taskItem.priority });
        }
    }

    async drain() {
        if (!this._hasPendingTasks() && this.activeCount === 0) {
            return Promise.resolve();
        }
        return new Promise(resolve => {
            this.drainResolvers.add(resolve);
        });
    }

    _resolveDrains() {
        for (const resolve of this.drainResolvers) {
            resolve();
        }
        this.drainResolvers.clear();
    }

    async shutdown(options = {}) {
        this.isShuttingDown = true;

        for (const timer of this.retryTimers) {
            clearTimeout(timer);
        }
        this.retryTimers.clear();

        this.queues.high = [];
        this.queues.normal = [];
        this.queues.low = [];

        if (options.force) {
            return Promise.resolve();
        } else {
            if (this.activeCount === 0 && !this._hasPendingTasks()) {
                this._resolveDrains();
                return Promise.resolve();
            }
            return new Promise(resolve => {
                this.drainResolvers.add(resolve);
            });
        }
    }
}
