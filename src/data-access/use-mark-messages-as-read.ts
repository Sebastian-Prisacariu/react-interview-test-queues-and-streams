import { Message, MessageId } from "@/types/message";
import { Array, Cause, Chunk, DateTime, Duration, Option, Queue, Random, Schedule, Stream } from "effect";

import { AppRuntime } from "@/lib/app-runtime";
import { NetworkMonitor } from "@/lib/services/network-monitor";
import { Effect } from "effect";
import React from "react";
import { MessagesQuery } from "./use-messages-query";

const queue = AppRuntime.runSync(Queue.unbounded<Message['id']>());

const sendBatch = (chunk: Chunk.Chunk<Message['id']>) =>
    Effect.flatMap(NetworkMonitor, ({ latch }) =>
        Effect.gen(function* () {
            yield* Effect.log(`[Queue] batching: ${Chunk.join(chunk, ", ")}`)

            const sleepFor = yield* Random.nextRange(1_000, 2_500);
            yield* Effect.sleep(`${sleepFor} millis`);

            yield* Effect.tryPromise(() => Promise.resolve(chunk)).pipe(
                Effect.retry({
                    times: 3,
                    schedule: Schedule.exponential(Duration.millis(500)),
                })
            )
        }).pipe(
            latch.whenOpen,
            Effect.retry({
                times: 3,
                schedule: Schedule.exponential(Duration.millis(500)),
            })
        ))

Stream.fromQueue(queue)
    .pipe(
        Stream.tap((id) => Effect.log(`[Queue] Message ID: ${id}`)),
        Stream.groupedWithin(25, Duration.seconds(5)),
        Stream.mapEffect(sendBatch, { concurrency: "unbounded" }),
        Stream.catchAllCause((cause) => Effect.log(`[Queue] Error: ${Cause.squash(cause)}`)),
        Stream.runDrain,
        AppRuntime.runFork
    );

const offer = (id: Message['id']) => {
    Queue.unsafeOffer(queue, id)
    MessagesQuery.setQueryData(Array.map((message) => message.id === id ? { ...message, readAt: DateTime.unsafeNow() } : message));
}

export const useMarkMessagesAsRead = ({ messages }: { messages: Message[] }) => {

    const unreadMessages = React.useMemo(() =>
        messages.filter((message) => message.readAt === null),
        [messages])

    React.useEffect(() => {
        const handleFocus = () => {
            if (!document.hasFocus()) return;

            unreadMessages.forEach((message) => {
                const element = document.querySelector(`[data-message-id="${message.id}"]`);
                if (!element) return;
                const rect = element.getBoundingClientRect();
                const ifFullyVisible = rect.top >= 0 && rect.bottom <= window.innerHeight;
                if (ifFullyVisible) {
                    offer(message.id);
                }

            });
        }

        window.addEventListener("focus", handleFocus)
        return () => {
            window.removeEventListener("focus", handleFocus)
        }

    }, [unreadMessages]);

    const observer = React.useRef<IntersectionObserver | null>(null);
    React.useEffect(() => {
        observer.current = new IntersectionObserver(
            Array.forEach((entry) => {
                if (!entry.isIntersecting || !document.hasFocus()) return;

                const messageId = Option.fromNullable(entry.target.getAttribute('data-message-id')).pipe(
                    Option.flatMap(Option.liftPredicate((str) => str === "")),
                    Option.map(MessageId.make)
                );

                if (Option.isSome(messageId)) {
                    offer(messageId.value);
                }

                observer.current?.unobserve(entry.target);
            }),
            { threshold: 1 });

        return () => {
            observer.current?.disconnect();
        };
    }, []);

    return {
        observer,
    };
}