export type WorkerTaskFailure =
  | { readonly kind: 'abort'; readonly reason: unknown }
  | { readonly kind: 'timeout' | 'worker-error' }
  | { readonly kind: 'post-error' | 'receive-error'; readonly error: unknown };

interface OwnedWorkerTaskOptions<Message, Result> {
  readonly worker: Worker;
  readonly request: unknown;
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
  readonly receive: (message: Message) => { readonly kind: 'continue' } | { readonly kind: 'complete'; readonly value: Result };
  /** Return a domain failure result or throw to reject, after releasing the worker. */
  readonly failure: (failure: WorkerTaskFailure) => Result;
}

/** Owns one worker and settles once. Creation, protocol and fallback policy belong to callers. */
export function startOwnedWorkerTask<Message, Result>(options: OwnedWorkerTaskOptions<Message, Result>) {
  const { worker, request, signal, timeoutMs, receive, failure } = options;
  let cancel = () => {};
  const result = new Promise<Result>((resolve, reject) => {
    let finished = false;
    const finish = (complete: () => Result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      worker.removeEventListener('messageerror', workerFailed);
      worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null;
      worker.terminate();
      try { resolve(complete()); }
      catch (error) { reject(error); }
    };
    const fail = (cause: WorkerTaskFailure) => finish(() => failure(cause));
    const abort = () => fail({ kind: 'abort', reason: signal?.reason });
    const timeout = setTimeout(() => fail({ kind: 'timeout' }), timeoutMs);
    cancel = abort;
    worker.onmessage = (event: MessageEvent<Message>) => {
      if (finished) return;
      try {
        const next = receive(event.data);
        if (next.kind === 'complete') finish(() => next.value);
      } catch (error) { fail({ kind: 'receive-error', error }); }
    };
    const workerFailed = () => fail({ kind: 'worker-error' });
    worker.onerror = workerFailed;
    // Some browsers expose messageerror only through EventTarget, without an IDL handler property.
    worker.addEventListener('messageerror', workerFailed);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    try { worker.postMessage(request); }
    catch (error) { fail({ kind: 'post-error', error }); }
  });
  return { result, cancel: () => cancel() };
}
