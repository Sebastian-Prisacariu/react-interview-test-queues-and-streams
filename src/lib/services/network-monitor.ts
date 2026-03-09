import { Chunk, Effect, Stream } from "effect";

export class NetworkMonitor extends Effect.Service<NetworkMonitor>()("NetworkMonitor", {
    effect: Effect.gen(function* () {
        const latch = yield* Effect.makeLatch();

        Stream.async((emit) => {
            window.addEventListener("online", () => emit(Effect.succeed(Chunk.of(true))));
            window.addEventListener("offline", () => emit(Effect.succeed(Chunk.of(false))));

        }).pipe(
            Stream.tap((isOnline) => (isOnline ? latch.open : latch.close)),
            Stream.runDrain,
            Effect.forever
        )

        return { latch }
    })
}) { }