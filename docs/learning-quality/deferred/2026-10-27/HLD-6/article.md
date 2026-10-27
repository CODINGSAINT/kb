## Problem

Asha sends “Meet at six?” to Bilal in conversation C42. The server stores it, but Asha's connection drops before the acknowledgement arrives. Bilal's phone later receives message 3 while message 2 is missing; his laptop has been offline. Someone is then removed from the group.

Design chat so retries do not invent another logical message, gaps are repaired explicitly, and a connection or receipt never claims more than it proves.

## Requirements

| Clarifying question | Chosen answer and consequence |
| --- | --- |
| Direct or group chat? | Both, with moderate groups up to 500 current members. Very large broadcast channels need another fanout policy. |
| What is ordered? | Accepted messages within one conversation, by a server-owned sequence. There is no global order across independent conversations or devices' wall clocks. |
| What do the ticks mean? | Accepted=committed by the service; delivered=device reports contiguous receipt in its available history window; read=explicit user/device read signal. |
| What history may a member read? | Current membership is required. A new/rejoining member starts after joining; removal revokes later send/history authorization. Previously authorized/in-flight bytes cannot be recalled. |
| How long is history retained? |30 days for this product. Reconnect beyond retention returns an explicit missing-history boundary, not a false complete replay. |
| What security model is chosen? | TLS in transit and managed encryption at rest; the service is trusted with plaintext. End-to-end encryption is a separate requirement, not implied here. |
| What latency targets are proposed? | Healthy home-region p99 durable acceptance below 150 ms and online device receipt below 300 ms. Measure them separately; no guarantee for an offline device. |

Text messages are immutable in this initial solution. Media uses authorized object references; typing/presence is ephemeral. Calls, edits, searchable encrypted history and cross-region active-active conversation ownership are outside the first design.

## 1. Size messages, fanout and connections separately

Use **5 million daily users**, **50 messages/user/day**, **a ten-times peak factor**, and **800 encoded bytes/message** including text/metadata. Assume 80% direct messages, 20% group messages averaging 20 other recipients, and two recipient devices each. This is a workload model, not hardware evidence.

| Quantity | Calculation | Result |
| --- | --- | --- |
| Accepted messages | `5M × 50 / 86,400 s` | `2,894/s` average; about 28,935/s peak |
| Logical history bytes | `250M × 800 B` | `200 GB/day`;6 TB for 30 days |
| Three history copies | `3 × 6 TB` |18 TB before indexes, dedup, receipts and media |
| Mean recipient users/message | `0.8×1 + 0.2×20` |4.8 |
| Device delivery attempts/message | `4.8 × 2` |9.6 if all modeled devices are online |
| Peak live fanout | `28,935 × 9.6` |About 277,778 device attempts/s |
| Peak payload egress | `277,778/s × 800 B` |About 222 MB/s before transport overhead |
| One million live connections | `1M × 64 KiB/connection` assumed |About65.5 GB of fleet memory for connection state/buffers alone |

Actual frame sizes, online-device fraction, attachment traffic, buffer memory and replication overhead need measurement. Connection count, message commit rate and fanout rate are different bottlenecks. A gateway that handles many idle sockets may fail under a smaller number of slow consumers with full buffers.

If one million clients reconnect and recovery admits 10,000 authentications/history starts per second, the minimum drain time is 100 seconds before other work. Jittered reconnects, bounded history batches and admission matter. The [WebSocket specification's abnormal-close recovery section](https://www.rfc-editor.org/rfc/rfc6455.html#section-7.2.3) explicitly discusses reconnect storms/backoff; WebSocket itself does not store missed chat history.

## 2. Message, membership and receipt contracts

The authenticated connection binds user and device identity. The request cannot choose somebody else's sender ID.

```text
SEND {conversationId:C42, clientMessageId:phone-uuid-7, text:"Meet at six?"}
  -> ACCEPTED {messageId:C42/1, sequence:1}
SYNC {conversationId:C42, afterSeq:104, limit:100}
  -> ordered messages, nextAfter, lastSequence
   | HISTORY_GAP {reason, earliestAvailable, resetAfter}
ACK_DELIVERED {conversationId, deviceId, historyFrom, throughSeq}
ACK_READ      {conversationId, deviceId, historyFrom, throughSeq}
```

`clientMessageId` identifies one logical send and survives retries. The unique key is `(conversation, sender, clientMessageId)`; a different body under that identity conflicts. Two distinct IDs with the same text are two messages. Check current membership before replaying a prior accepted result, so removal is not bypassed through a retry endpoint.

| Record | Key and owner |
| --- | --- |
| `conversation` | Conversation ID, next committed sequence, current owner term; orders appends and membership changes. |
| `membership` | `(conversation,user)`; role, active state, source version and history-from sequence. |
| `message` | `(conversation,sequence)` primary key; stable message ID, sender, payload/reference and accepted time. Range index serves `sequence > after`. |
| `send_request` | Unique `(conversation,sender,clientMessageId)` with payload fingerprint and accepted receipt; owns retry identity. |
| `delivery_outbox` | Stable conversation/message event identity, publication/checkpoint state; committed with the message. |
| `device_cursor` | `(user,device,conversation)`; available-history floor, delivered/read high-water marks and receipt version. |
| `connection_session` | `(user,device,session)` gateway route/epoch and heartbeat expiry. Soft routing state, not durable message authority. |

For the chosen30-day dedup retention, the SDK retries an unresolved send only within its documented retry window (for example24 hours) and reuses the same ID. After the server's dedup window expires, it cannot promise a replay of that old identity. Do not silently turn an indefinitely old ambiguous operation into a new message. Keep payload retention and retry metadata policies separate; a retained acknowledgement must not restore an expired body.

## 3. Final design diagram

[![Authenticated device connections send through conversation owners to durable logs/membership; an outbox fans out to gateway sessions, while device receipts, presence and media have separate roles.](designs/hld-6.svg)](designs/hld-6.svg)

**Gateways** maintain authenticated WebSocket connections and bounded output queues. The **conversation owner** validates membership and serializes appends against the **durable message/membership store**. It acknowledges only after the message, counter, dedup result and **delivery outbox** commit. Fanout uses the **session registry/presence hint** to reach devices, while missed delivery remains recoverable from the log.

The **device cursor store** tracks each device's reports. It is distinct from source acceptance and from another device's progress. The **media store** holds large objects; a message carries an authorized attachment ID, not a permanent public URL or an unchecked local file path.

One logical owner per conversation keeps order local. Many conversations are distributed across owners/shards; the design does not introduce one global counter for every chat.

## 4. Work through a lost acknowledgement and a gap

![A send commits once under its client identity. Losing the acknowledgement leads to a replay of the same accepted message, not another append.](learning-figures/hld-6-accept.svg)

**Why this picture:** a dropped response does not establish whether the message was accepted. Asha retries the same client ID. If the first transaction committed, she receives C42/1 again; otherwise one later transaction can accept it. Returning success before commit would let an acknowledged message vanish after a crash.

![Receiving sequence 3 after sequence 1 buffers3 while the contiguous cursor remains1. Replay supplies2, the cursor advances through 3, and a separate read action changes read state.](learning-figures/hld-6-gap.svg)

**Why this picture:** the largest sequence seen is not the largest complete prefix received. Bilal's phone receives1, then3. It buffers3, keeps delivered-through 1 and asks for history after 1. Receiving2 closes the gap and drains3. A duplicate3 is ignored. Read-through stays0 until the user explicitly reads; the laptop's cursor can still be0.

If the missing range has expired or predates membership, the server returns `HISTORY_GAP` and the earliest allowed sequence. The client shows a history boundary before resetting its baseline. That baseline is outside the available range, not proof that unavailable messages were received/read.

[Follow retry, gap repair and membership/retention boundaries](learning-labs/chat.html). All messages are synthetic and the states are generated by the Java mechanism; manual controls and a full text fallback are available.

## 5. Detailed decisions and failure behaviour

### Commit order and retry identity together

For one conversation, lock its metadata row, check current membership, resolve the sender/client-ID request, allocate the next sequence, insert message/dedup/outbox and update the counter in one transaction. Only a successful commit permits `ACCEPTED`. Membership changes use the same ordering authority. Two concurrent senders receive one committed order regardless of their device timestamps.

Use a counter updated with the conversation transaction if this protocol relies on a complete integer range. A generic auto-increment/sequence generator is not automatically a gapless committed log: [PostgreSQL 17 sequence documentation](https://www.postgresql.org/docs/17/functions-sequence.html) explains that aborted transactions can leave sequence gaps. If a different implementation allows such holes, its sync protocol must carry explicit committed-range/skip information; clients cannot infer that every missing integer is a lost message.

A single network owner can batch appends, but must preserve deduplication and commit semantics. Partition independent conversations across owners. Fence an old owner with an authority term checked by storage before admitting a replacement; a gateway route cache or clock lease alone cannot make two isolated owners safe writers. A timestamp-based global ID is useful for identity but does not replace agreement on one conversation's accepted order.

Use synchronously durable replication/eligible failover if the chosen accepted-message promise must survive a single-zone failure. Test that acknowledgement policy and old-primary fencing. Asynchronous cross-region copies can lose recent accepted data, so regional RPO/RTO must be agreed rather than hidden under “no message loss.” Backups also need tested restore and replay.

### Online delivery is an optimization over replayable history

The outbox publishes accepted message identities. Fanout workers consult current membership and live device sessions, then enqueue to bounded gateway output buffers. Duplicate events are harmless only when devices deduplicate by stable message identity. A queue acknowledgement does not prove device receipt.

The registry is `(user,device,session) -> gateway, sessionEpoch, expiry`, not one gateway per user. An old disconnect removes only its matching session/epoch, so it cannot delete a replacement connection. Presence heartbeats/TTL may be stale. Routing to a stale gateway causes retry/replay; it must not delete the source message or decide whether history exists.

For a slow consumer, cap queued bytes and waiting time, then disconnect with a resume path instead of exhausting gateway memory. Push notifications are optional wake-up hints. A provider accepting a push is not a chat delivery/read receipt; avoid sensitive body text in a lock-screen hint. Offline devices fetch durable ranges when they return.

Moderate groups can expand message references to current members/devices while storing the body once. Large channels need shared-log pull or hierarchical broadcast, different fairness and a different group-size contract. One hot conversation still serializes even when the rest of the fleet is sharded. Rate-limit abusive/hot rooms and measure batching before claiming that another shard solves that room's order bottleneck.

### Reconnect, receipt windows and membership

On reconnect, authenticate the user/device again and request each conversation after its durable local contiguous cursor. Receive live events and range results with the same stable IDs. Buffer a bounded out-of-order tail; if a gap exceeds that budget, request replay rather than allocating unbounded memory. Do not acknowledge through 107 merely because107 arrived after 104.

`HISTORY_GAP` distinguishes an unavailable range from a temporary delivery gap. The client presents a boundary and resumes after `earliestAvailable-1`; it does not silently claim receipt of expired or pre-join messages. Receipts carry that `historyFrom` window. A baseline immediately below the window is a starting position, not proof of old delivery/read.

Server receipt updates authenticate device ownership, stay within the conversation/visible accepted range and use monotonic compare/update within the window. `readThrough` cannot exceed reported `deliveredThrough` for that device. Duplicate/out-of-order receipts cannot move a cursor backward. This is client-reported evidence, not proof of human attention. The sender UI can define delivered as “at least one recipient device reported receipt”; groups need per-recipient counts and an explicit audience policy instead of ambiguous universal double ticks.

Removal affects send/history and subsequent fanout authorization decisions. Close/revoke matching live subscriptions and reject stale membership versions. A previously authorized/in-flight message may still arrive; it cannot be recalled. Rejoining starts a new history floor under the chosen policy. Device authentication does not override group membership, and an offline delivery reference is not an access grant.

Keep the 30-day retention policy explicit. Expire payloads/media according to it, retain the minimum needed receipt/dedup metadata under separate bounds and expose unavailable history honestly. If message deletion is later added, use a tombstone/control event with defined cursor behavior, not a mysteriously missing sequence that every device retries forever.

### Complete Java 21 source mechanism

`ConversationLog` supplies current membership, one local ordered log, sender/client-ID fingerprints, stable accepted receipts, retention pruning and explicit sync gaps. Its append decision is the actual checked source:

{{excerpt:examples/learning-java/src/kb/chat/ConversationLog.java#send}}

History checks current membership and returns a boundary when complete replay is unavailable:

{{excerpt:examples/learning-java/src/kb/chat/ConversationLog.java#sync}}

`ClientCursor` buffers a bounded tail and advances only a complete prefix. Read state remains separate:

{{excerpt:examples/learning-java/src/kb/chat/ClientCursor.java#receive}}

The full code defines the records, fixture permissions, hashing and diagnostics. Metadata maps are retained in memory for the small example; production needs durable transactions, lifecycle cleanup and the stated retry retention. A monitor does not prove server failover or database durability. Client window resets are driven by explicit synthetic server gap responses; this is not a production authenticated transport.

With Java 21 on PATH, run from the repository root:

```powershell
New-Item -ItemType Directory -Force .learning-work/chat-classes | Out-Null
javac -encoding UTF-8 -d .learning-work/chat-classes examples/learning-java/src/kb/chat/*.java
java -cp .learning-work/chat-classes kb.chat.ChatChecks
java -cp .learning-work/chat-classes kb.chat.ChatTrace
```

Checks cover lost-ack retry, changed-payload conflicts, conversation order, out-of-order repair/dedup, device/read separation, member removal/rejoin, retention gaps, bounded buffers and 32 concurrent retries of one send. They establish local mechanisms, not real socket delivery or a distributed durability/latency guarantee.

### Security, media and operations

Use authenticated `wss` sessions with origin checks appropriate to the browser/authentication model, token renewal/revocation and per-user/conversation limits. Bound frames, decoded text, attachments, buffers and sync batch sizes. Do not log message bodies or credentials. Scope receipts/presence/history to authorized users; a guessed conversation ID must not grant access.

[TLS 1.3](https://www.rfc-editor.org/rfc/rfc8446.html) protects the transport endpoints; it does not prevent a trusted terminating chat service from seeing plaintext. End-to-end encryption would require a reviewed sender/recipient device-key protocol, verification, group membership/rekeying, attachment protection and recovery policy. It changes search/moderation/history distribution. Do not invent that protocol or label the plaintext Java exercise end-to-end encrypted.

Media upload uses a separate authorized session, size/checksum/content validation and immutable storage reference; publish the message only once that reference is usable. Downloads recheck membership/policy, and short-lived signed links may remain usable until their expiry unless the edge checks current access. Retention and member removal cannot erase already downloaded copies.

Measure durable-accept latency/errors separately from live delivery, contiguous-gap repair and user-read delay. Track dedup conflicts, owner-term rejects, outbox age, per-conversation hot spots, gateway queued bytes, reconnect admission, sync gaps by reason and receipt regressions. Presence accuracy is a routing metric, not a durability metric. Avoid unbounded message/user labels in metrics; use restricted sampled traces.

Failure exercises: commit followed by lost sender acknowledgement; crash before/after outbox publication; gateway restart/reconnect storm; duplicate/reordered live events; stale session disconnect; member removal during backlog; history beyond retention; old owner after failover; one hot group; slow device buffers; unavailable policy/storage. Test the supported failure model, restore procedure and p99 under realistic group fanout instead of treating a successful local concurrency test as “no message loss.”

## 6. Interviewer follow-ups

**Does a WebSocket write mean delivered?** No. It may only enqueue bytes locally. The application needs its durable acceptance protocol and per-device receipt evidence.

**Why not use device timestamps for order?** Clocks can differ and simultaneous senders disagree. A conversation owner chooses a committed sequence; independent conversations need no common order.

**What if the sender retries a lost acknowledgement?** Reuse the same conversation/sender/client ID. An authorized retry returns the original accepted receipt; changed payload conflicts.

**Can Bilal's laptop inherit his phone's delivered cursor?** No. Each device may lack different content. A user-read aggregation can be a separate policy, but it must not claim delivery to the laptop.

**What if the missing message has expired?** Return an explicit history gap and earliest available sequence. The client acknowledges that boundary before starting a new available window.

**Can a removed member replay offline references?** Current membership is required at history/send/fanout authorization. References and old sockets do not override it; already authorized/in-flight bytes remain a stated limit.

**Does at-least-once transport imply duplicate user messages?** Stable source identities and client dedup can render one logical message per ID within the documented retry/retention contract. This does not make every notification, connection, read signal or remote side effect exactly once.

**What ships first?** Durable per-conversation append/dedup, current membership, bounded gateway delivery, per-device replay and distinct receipts. Add richer groups, encryption requirements and multi-region ownership only with complete protocols.

## 7. Closing answer

I would commit each message and retry identity under one conversation order before acknowledging acceptance. Gateways provide live delivery, while durable sequence ranges repair reconnect gaps. Devices keep separate contiguous receive/read state and explicitly recognize unavailable history. Membership and retention remain authority decisions; presence is a hint. Sharding scales independent conversations, but owner fencing, durability tests and bounded recovery define the real reliability promise.
