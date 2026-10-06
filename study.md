# Java LLD Interview Questions

| # | Problem | Key concepts you should practice |
|---|---|---|
| 1 | Design Chess | OOP, inheritance, polymorphism, Strategy, State |
| 2 | Design Parking Lot | Factory, Strategy, composition, extensibility |
| 3 | Design Elevator System | State, Strategy, scheduling, concurrency |
| 4 | Design BookMyShow / Movie Booking | Seat locking, concurrency, transactions, State |
| 5 | Design ATM | State pattern, Chain of Responsibility, Strategy |
| 6 | Design Car Rental System | Factory, Strategy, inventory management |
| 7 | Design Uber / Cab Booking | Strategy, Observer, matching, concurrency |
| 8 | Design Food Delivery System | State machine, Strategy, Observer |
| 9 | Design Library Management System | OOP, relationships, State |
| 10 | Design Splitwise | Strategy, Factory, graph/data modeling |
| 11 | Design Coffee Vending Machine | State, Factory, inventory |
| 12 | Design Shopping Cart | Strategy, pricing rules, promotions |
| 13 | Design Notification System | Strategy, Factory, Observer, extensibility |
| 14 | Design Rate Limiter | Strategy, concurrency, algorithms |
| 15 | Design Wallet / Payment System | State, Strategy, transactions, idempotency |
| 16 | Design Tic-Tac-Toe | OOP, Strategy, game state |
| 17 | Design Snake & Ladder | Strategy, game engine, extensibility |
| 18 | Design Train Reservation System | Seat allocation, locking, concurrency |
| 19 | Design Amazon Order Management | State machine, Observer, Strategy |
| 20 | Design Calendar / Meeting Scheduler | Interval algorithms, concurrency, conflict resolution |

## How I'd structure your preparation

Don't treat these as 20 unrelated questions. They form a progression.

### Level 1 — Core OOP

Start with:
- Tic-Tac-Toe
- Snake & Ladder
- Library Management
- Chess

You'll practice:
- Encapsulation
- Inheritance
- Composition
- Polymorphism
- Interfaces
- Abstract classes
- Enums
- Object relationships

### Level 2 — Design Patterns

Then:
- Parking Lot
- Coffee Vending Machine
- ATM
- Notification System
- Shopping Cart

Patterns you'll repeatedly encounter:
- Factory
- Strategy
- Observer
- State
- Chain of Responsibility
- Template Method

This is important because interviewers usually don't ask:
> "Explain Strategy Pattern."

They ask:
> "How would you design this so that adding another payment method doesn't require modifying existing code?"

That's where patterns become useful rather than decorative.

### Level 3 — Concurrency

Then move to:
- BookMyShow
- Train Reservation
- Elevator
- Rate Limiter
- Payment System

Now you'll have to think about:
- Race conditions
- Locks
- `synchronized`
- `ConcurrentHashMap`
- `AtomicInteger`
- `AtomicLong`
- `ReentrantReadWriteLock`
- `BlockingQueue`
- Idempotency
- Double booking
- Thread safety

For example:

```text
User A        ────────┐
                      ├──→ Seat A1
User B        ────────┘
```

Your design must guarantee: only ONE user gets A1.

### Level 4 — Real-world LLD

Then:
- Uber
- Food Delivery
- Amazon Order Management
- Car Rental
- Calendar
- Splitwise

These force you to combine everything.

For example:

```text
                 Order
                   |
        +----------+----------+
        |          |          |
     CREATED   CONFIRMED   CANCELLED
                   |
                SHIPPED
                   |
                DELIVERED
```

That's where State Machine + Observer + Strategy + concurrency start working together.

# 20 HLD problems to cover the interview space

| # | HLD Problem | Main concepts covered |
|---|---|---|
| 1 | URL Shortener | Hashing, DB design, caching, read-heavy systems, ID generation |
| 2 | Rate Limiter | Distributed counters, Redis, algorithms, consistency, race conditions |
| 3 | Distributed Cache | Consistent hashing, replication, eviction, partitioning |
| 4 | Notification System | Kafka, queues, fan-out, retries, DLQ, multi-channel delivery |
| 5 | News Feed | Fan-out on write/read, ranking, caching, pagination |
| 6 | Chat / WhatsApp | WebSockets, message ordering, delivery guarantees, presence |
| 7 | YouTube | Video upload, transcoding, CDN, object storage, streaming |
| 8 | Netflix | CDN, adaptive streaming, recommendation, availability |
| 9 | Uber | Geo-indexing, location updates, matching, distributed systems |
| 10 | Google Drive / Dropbox | File storage, chunking, synchronization, metadata, conflict resolution |
| 11 | Google Search | Crawling, indexing, inverted index, ranking, distributed search |
| 12 | Amazon E-Commerce | Catalog, cart, order, inventory, payment, event-driven architecture |
| 13 | BookMyShow | Distributed locking, inventory, transactions, concurrency |
| 14 | Payment System | Idempotency, transactions, retries, reconciliation, webhooks |
| 15 | Distributed Job Scheduler | Scheduling, workers, queues, leader election, retries |
| 16 | Logging / Monitoring System | High-volume ingestion, Kafka, aggregation, storage, querying |
| 17 | Metrics / Time-Series System | Time-series DB, aggregation, retention, downsampling |
| 18 | Ride/Delivery Tracking | GPS ingestion, geo queries, real-time updates, WebSockets |
| 19 | Ticket / Seat Reservation System | Strong consistency, locking, expiration, transactions |
| 20 | Large-scale API Gateway | Routing, authentication, rate limiting, load balancing, observability |

# 20 AI topics — Basic → Spring AI Mastery

| # | Topic | What you should master |
|---|---|---|
| 1 | AI/LLM Fundamentals | AI vs ML vs DL vs GenAI, LLMs, tokens, context window, inference |
| 2 | Prompt Engineering | System/user prompts, few-shot, roles, prompt templates, grounding |
| 3 | LLM Parameters & APIs | Temperature, top-p, max tokens, streaming, model selection |
| 4 | Embeddings & Semantic Search | Embeddings, cosine similarity, semantic retrieval |
| 5 | RAG Fundamentals | Documents + chunks + embeddings + vector DB + retrieval + LLM |
| 6 | Spring AI Fundamentals | Starters, auto-configuration, ChatModel, configuration |
| 7 | ChatClient Mastery | Fluent API, prompts, structured output, streaming, advisors |
| 8 | Structured Output | POJOs, JSON/schema, response formats, validation, retries |
| 9 | Conversation Memory | Chat memory, conversation IDs, persistent memory, context management |
| 10 | Vector Stores | PGVector, Redis, Elasticsearch/OpenSearch, metadata filtering |
| 11 | Production RAG | Chunking, metadata, hybrid search, reranking, query rewriting |
| 12 | Spring AI Advisors | Advisor chain, custom advisors, memory/RAG/tool advisors |
| 13 | Tool Calling / Function Calling | Tool, callbacks, tool execution, tool context, security |
| 14 | AI Agents & Agent Loops | Planning, tool loops, state, reflection, multi-step execution |
| 15 | MCP / MCP Client/Server | Tools/resources/prompts, remote tool ecosystems |
| 16 | Multi-Agent Architecture | Supervisors, workers, delegation, agent-to-agent workflows |
| 17 | AI Observability & Evaluation | Tracing, metrics, token usage, evaluation, hallucination detection |
| 18 | AI Security | Prompt injection, tool abuse, data leakage, PII, authorization |
| 19 | Production AI Architecture | Model routing, fallback, caching, rate limits, cost, resilience |
| 20 | Spring AI Master Project | Enterprise Agent + RAG + MCP + tools + memory + observability |
