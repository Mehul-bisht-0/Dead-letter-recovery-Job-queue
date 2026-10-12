from __future__ import annotations

import os
import textwrap
from dataclasses import dataclass
from html import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.platypus import (
    Flowable,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "output", "pdf", "reliable_job_queue_study_guide.pdf")


PALETTE = {
    "ink": colors.HexColor("#16202A"),
    "muted": colors.HexColor("#5C6B73"),
    "blue": colors.HexColor("#2F6FED"),
    "teal": colors.HexColor("#1F9D8A"),
    "green": colors.HexColor("#2D9D5B"),
    "amber": colors.HexColor("#B36B00"),
    "red": colors.HexColor("#C23B32"),
    "purple": colors.HexColor("#7057B8"),
    "line": colors.HexColor("#CBD5E1"),
    "soft": colors.HexColor("#F4F7FB"),
    "soft2": colors.HexColor("#EEF6F4"),
    "soft3": colors.HexColor("#FFF7E8"),
    "white": colors.white,
}


styles = getSampleStyleSheet()
styles.add(
    ParagraphStyle(
        name="TitleCustom",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=25,
        leading=30,
        textColor=PALETTE["ink"],
        alignment=TA_CENTER,
        spaceAfter=14,
    )
)
styles.add(
    ParagraphStyle(
        name="Subtitle",
        parent=styles["BodyText"],
        fontSize=11,
        leading=15,
        textColor=PALETTE["muted"],
        alignment=TA_CENTER,
        spaceAfter=18,
    )
)
styles.add(
    ParagraphStyle(
        name="H1Custom",
        parent=styles["Heading1"],
        fontName="Helvetica-Bold",
        fontSize=18,
        leading=22,
        textColor=PALETTE["ink"],
        spaceBefore=6,
        spaceAfter=8,
    )
)
styles.add(
    ParagraphStyle(
        name="H2Custom",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=13,
        leading=16,
        textColor=PALETTE["ink"],
        spaceBefore=8,
        spaceAfter=6,
    )
)
styles.add(
    ParagraphStyle(
        name="BodyCustom",
        parent=styles["BodyText"],
        fontSize=9.2,
        leading=12.2,
        textColor=PALETTE["ink"],
        spaceAfter=5,
    )
)
styles.add(
    ParagraphStyle(
        name="Small",
        parent=styles["BodyText"],
        fontSize=7.8,
        leading=10,
        textColor=PALETTE["muted"],
        spaceAfter=3,
    )
)
styles.add(
    ParagraphStyle(
        name="Cell",
        parent=styles["BodyText"],
        fontSize=7.8,
        leading=9.6,
        textColor=PALETTE["ink"],
    )
)
styles.add(
    ParagraphStyle(
        name="CellSmall",
        parent=styles["BodyText"],
        fontSize=7.2,
        leading=8.8,
        textColor=PALETTE["ink"],
    )
)
styles.add(
    ParagraphStyle(
        name="HeaderCell",
        parent=styles["BodyText"],
        fontName="Helvetica-Bold",
        fontSize=7.8,
        leading=9,
        textColor=colors.white,
    )
)
styles.add(
    ParagraphStyle(
        name="Callout",
        parent=styles["BodyText"],
        fontSize=8.2,
        leading=10.5,
        textColor=PALETTE["ink"],
        backColor=PALETTE["soft"],
        borderColor=PALETTE["line"],
        borderWidth=0.5,
        borderPadding=7,
        spaceBefore=4,
        spaceAfter=6,
    )
)


def P(text: str, style: str = "BodyCustom") -> Paragraph:
    return Paragraph(text, styles[style])


def code(text: str) -> str:
    return f'<font name="Courier">{escape(text)}</font>'


def source(text: str) -> Paragraph:
    return P(f"<b>Source anchors:</b> {escape(text)}", "Small")


def bullets(items: list[str], style: str = "BodyCustom") -> list[Paragraph]:
    return [P("- " + item, style) for item in items]


def table(data, widths=None, header=True, small=False):
    style_name = "CellSmall" if small else "Cell"
    converted = []
    for r, row in enumerate(data):
        converted.append([
            P(str(cell), "HeaderCell" if header and r == 0 else style_name)
            for cell in row
        ])
    t = Table(converted, colWidths=widths, repeatRows=1 if header else 0, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), PALETTE["ink"] if header else colors.white),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white if header else PALETTE["ink"]),
        ("GRID", (0, 0), (-1, -1), 0.35, PALETTE["line"]),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PALETTE["soft"]]),
    ]))
    return t


@dataclass
class Box:
    x: float
    y: float
    w: float
    h: float
    title: str
    body: str
    fill: colors.Color


class Diagram(Flowable):
    def __init__(self, width=500, height=260, kind="architecture"):
        super().__init__()
        self.width = width
        self.height = height
        self.kind = kind

    def wrap(self, availWidth, availHeight):
        self.scale = min(1.0, availWidth / self.width)
        return self.width * self.scale, self.height * self.scale

    def draw(self):
        c = self.canv
        c.saveState()
        c.scale(getattr(self, "scale", 1.0), getattr(self, "scale", 1.0))
        if self.kind == "architecture":
            self._architecture(c)
        elif self.kind == "sequence":
            self._sequence(c)
        elif self.kind == "aws":
            self._aws(c)
        elif self.kind == "deploy":
            self._deploy(c)
        c.restoreState()

    def _box(self, c, box: Box):
        c.setStrokeColor(PALETTE["line"])
        c.setFillColor(box.fill)
        c.roundRect(box.x, box.y, box.w, box.h, 6, fill=1, stroke=1)
        c.setFillColor(PALETTE["ink"])
        c.setFont("Helvetica-Bold", 8.5)
        c.drawCentredString(box.x + box.w / 2, box.y + box.h - 13, box.title)
        c.setFont("Helvetica", 6.8)
        c.setFillColor(PALETTE["muted"])
        lines = textwrap.wrap(box.body, width=max(12, int(box.w / 5.2)))
        y = box.y + box.h - 25
        for line in lines[:4]:
            c.drawCentredString(box.x + box.w / 2, y, line)
            y -= 8

    def _arrow(self, c, x1, y1, x2, y2, label="", color=None):
        color = color or PALETTE["ink"]
        c.setStrokeColor(color)
        c.setFillColor(color)
        c.setLineWidth(1.0)
        c.line(x1, y1, x2, y2)
        # Arrow head.
        import math
        ang = math.atan2(y2 - y1, x2 - x1)
        size = 5
        p1 = (x2 - size * math.cos(ang - 0.45), y2 - size * math.sin(ang - 0.45))
        p2 = (x2 - size * math.cos(ang + 0.45), y2 - size * math.sin(ang + 0.45))
        c.line(x2, y2, p1[0], p1[1])
        c.line(x2, y2, p2[0], p2[1])
        if label:
            c.setFont("Helvetica", 6.8)
            c.setFillColor(PALETTE["muted"])
            c.drawCentredString((x1 + x2) / 2, (y1 + y2) / 2 + 5, label)

    def _architecture(self, c):
        boxes = [
            Box(20, 175, 95, 50, "Client / Loadtest", "POST /jobs, status reads", PALETTE["soft"]),
            Box(150, 175, 105, 50, "Fastify API", "validation, idempotent enqueue", colors.HexColor("#EAF1FF")),
            Box(310, 178, 80, 44, "Redis 7", "ready sorted sets, priorities, locks", colors.HexColor("#FFECEC")),
            Box(305, 80, 100, 52, "Worker(s)", "claim, process, ack/nack, heartbeat", colors.HexColor("#EFFFF7")),
            Box(155, 72, 115, 62, "PostgreSQL", "jobs, DLQ, audit, heartbeats", colors.HexColor("#EEF4FF")),
            Box(20, 65, 95, 55, "Dashboard", "metrics, SSE, DLQ replay", colors.HexColor("#FFF6E6")),
            Box(430, 80, 70, 50, "Reaper", "leader lock, stale recovery", colors.HexColor("#F2ECFF")),
        ]
        for b in boxes:
            self._box(c, b)
        self._arrow(c, 115, 200, 150, 200, "HTTP")
        self._arrow(c, 255, 200, 310, 200, "ZADD")
        self._arrow(c, 202, 175, 202, 134, "INSERT")
        self._arrow(c, 310, 170, 355, 132, "Lua claim")
        self._arrow(c, 305, 105, 270, 105, "state writes")
        self._arrow(c, 115, 93, 155, 93, "read metrics")
        self._arrow(c, 115, 103, 155, 118, "DLQ replay")
        self._arrow(c, 405, 105, 430, 105, "stale jobs")
        self._arrow(c, 465, 130, 390, 178, "leader lock")
        c.setFont("Helvetica-Bold", 8)
        c.setFillColor(PALETTE["red"])
        c.drawString(292, 154, "async path")
        c.setStrokeColor(PALETTE["red"])
        c.setDash(3, 2)
        c.line(300, 150, 385, 150)
        c.setDash()

    def _sequence(self, c):
        actors = ["Client", "API", "Postgres", "Redis", "Worker", "Reaper/DLQ"]
        xs = [38, 120, 210, 300, 390, 480]
        for actor, x in zip(actors, xs):
            c.setFillColor(PALETTE["soft"])
            c.setStrokeColor(PALETTE["line"])
            c.roundRect(x - 32, 222, 64, 22, 4, fill=1, stroke=1)
            c.setFillColor(PALETTE["ink"])
            c.setFont("Helvetica-Bold", 7)
            c.drawCentredString(x, 230, actor)
            c.setStrokeColor(PALETTE["line"])
            c.line(x, 218, x, 18)
        steps = [
            (205, 38, 120, "POST /jobs"),
            (192, 120, 210, "advisory lock + INSERT"),
            (176, 120, 300, "ZADD + HSET"),
            (158, 390, 300, "EVAL claim.lua"),
            (142, 300, 390, "job id"),
            (126, 390, 210, "UPDATE processing"),
            (106, 390, 390, "handler runs"),
            (88, 390, 210, "success: UPDATE completed"),
            (70, 390, 210, "failure: UPDATE pending/dead"),
            (52, 390, 300, "retry: ZADD later"),
            (34, 210, 480, "exhausted: dead_letters + audit"),
        ]
        for y, x1, x2, label in steps:
            self._arrow(c, x1, y, x2, y, label, PALETTE["blue"] if x2 > x1 else PALETTE["teal"])
        c.setFont("Helvetica", 7)
        c.setFillColor(PALETTE["muted"])
        c.drawString(14, 10, "Visibility timeout is the Redis lock TTL plus jobs.locked_until; expired processing rows are requeued by the leader reaper.")

    def _aws(self, c):
        boxes = [
            Box(20, 190, 95, 48, "Route 53 / ALB", "public HTTP to API and dashboard", colors.HexColor("#EAF1FF")),
            Box(150, 190, 100, 48, "ECS Fargate", "API tasks and dashboard task", colors.HexColor("#EFFFF7")),
            Box(305, 190, 110, 48, "ECS Fargate Workers", "horizontally scaled worker tasks", colors.HexColor("#EFFFF7")),
            Box(35, 92, 110, 55, "ElastiCache Redis", "queue sorted sets, locks, leader key", colors.HexColor("#FFECEC")),
            Box(195, 92, 115, 55, "RDS PostgreSQL", "durable ledger, DLQ, audit, heartbeats", colors.HexColor("#EEF4FF")),
            Box(360, 92, 115, 55, "CloudWatch / X-Ray", "logs, metrics, traces, alarms", colors.HexColor("#FFF6E6")),
            Box(115, 25, 110, 42, "Secrets Manager", "DATABASE_URL, REDIS auth", colors.HexColor("#F2ECFF")),
            Box(285, 25, 110, 42, "Private Subnets", "DB/Redis locked inside VPC", PALETTE["soft"]),
        ]
        for b in boxes:
            self._box(c, b)
        self._arrow(c, 115, 214, 150, 214, "HTTP")
        self._arrow(c, 250, 205, 305, 205, "enqueue/load")
        self._arrow(c, 345, 190, 145, 147, "")
        self._arrow(c, 365, 190, 305, 147, "")
        self._arrow(c, 200, 190, 250, 147, "")
        self._arrow(c, 190, 190, 112, 147, "")
        self._arrow(c, 310, 116, 360, 116, "metrics/logs")
        self._arrow(c, 225, 45, 195, 92, "secrets")
        self._arrow(c, 340, 67, 252, 92, "network")

    def _deploy(self, c):
        boxes = [
            Box(20, 165, 80, 45, "Developer", "commit, PR", PALETTE["soft"]),
            Box(130, 165, 90, 45, "CI", "npm test, typecheck, build", colors.HexColor("#EAF1FF")),
            Box(250, 165, 90, 45, "Image Build", "multi-stage Dockerfile", colors.HexColor("#EFFFF7")),
            Box(370, 165, 90, 45, "Registry", "versioned images", colors.HexColor("#FFF6E6")),
            Box(70, 75, 105, 52, "Docker Compose", "local Postgres, Redis, API, worker, dashboard", PALETTE["soft"]),
            Box(230, 75, 115, 52, "Production Deploy", "ECS service update or K8s rollout", colors.HexColor("#EFFFF7")),
            Box(390, 75, 95, 52, "Observe", "logs, metrics, alerts, DLQ review", colors.HexColor("#F2ECFF")),
        ]
        for b in boxes:
            self._box(c, b)
        self._arrow(c, 100, 188, 130, 188, "push")
        self._arrow(c, 220, 188, 250, 188, "pass")
        self._arrow(c, 340, 188, 370, 188, "push")
        self._arrow(c, 415, 165, 288, 127, "release")
        self._arrow(c, 175, 101, 230, 101, "same env contract")
        self._arrow(c, 345, 101, 390, 101, "telemetry")
        c.setFillColor(PALETTE["red"])
        c.setFont("Helvetica-Bold", 8)
        c.drawString(20, 38, "Current repo note: no CI workflow file was found; CI/CD above is a suggested extension from existing npm and Docker scripts.")


def page_header_footer(canvas, doc):
    canvas.saveState()
    w, h = letter
    canvas.setStrokeColor(PALETTE["line"])
    canvas.line(doc.leftMargin, h - 0.42 * inch, w - doc.rightMargin, h - 0.42 * inch)
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(PALETTE["muted"])
    canvas.drawString(doc.leftMargin, h - 0.32 * inch, "Reliable Job Queue Study Guide")
    canvas.drawRightString(w - doc.rightMargin, 0.35 * inch, f"Page {doc.page}")
    canvas.restoreState()


def section(title: str):
    return [P(title, "H1Custom")]


def build_story():
    story = []

    story.append(Spacer(1, 0.35 * inch))
    story.append(P("Reliable Job Queue with Dead Letter Recovery", "TitleCustom"))
    story.append(P("Interview study guide generated from the actual TypeScript, Node.js, Redis, PostgreSQL, and Docker codebase.", "Subtitle"))
    story.append(P("<b>Read this as your defense script:</b> state what exists, explain why it exists, name the trade-offs, then say what you would add for production.", "Callout"))
    story.append(source("Repository inspected on 2026-08-07. Key files: README.md; package.json; Dockerfile; docker-compose.yml; packages/core/src/*; packages/api/src/*; packages/worker/src/*; packages/dashboard/src/*; packages/loadtest/src/*."))
    story.append(Spacer(1, 8))
    story.append(P("What you built in one sentence", "H2Custom"))
    story.extend(bullets([
        "A distributed background job system where HTTP clients enqueue work, Redis provides the fast ready queue and per-job locks, PostgreSQL stores the durable job ledger, workers process jobs concurrently, failed jobs retry with exponential backoff, and exhausted jobs move to a replayable dead letter queue.",
        "The intended processing guarantee is at-least-once, not exactly-once. Idempotency keys dedupe enqueue requests for 24 hours; downstream job handlers still need idempotent side effects.",
    ]))
    story.append(P("What to say if the interviewer asks for the punchline", "H2Custom"))
    story.extend(bullets([
        "Redis is used for speed and atomic claim operations. PostgreSQL is used for durability, queryability, DLQ state, audit history, and worker heartbeats.",
        "Lua is used where multiple Redis commands must behave like one critical section: find a ready job, choose highest priority in a batch, acquire a lock, and remove it from the queue.",
        "The main honest limitation is cross-store consistency. Redis and PostgreSQL are coordinated in application code, not in a distributed transaction. A production version needs reconciliation or an outbox pattern.",
    ]))
    story.append(PageBreak())

    story.extend(section("1. Project Overview"))
    story.append(P("Plain language", "H2Custom"))
    story.extend(bullets([
        "Some work should not happen inside a user-facing request. Sending email, calling webhooks, processing payments, or syncing data may be slow or flaky.",
        "This project lets an API accept work quickly, store it safely, and let worker processes do the work in the background.",
        "If a job fails, it is retried later. If it keeps failing, it is preserved in a dead letter queue so an operator can inspect and replay it.",
    ]))
    story.append(P("Technical language", "H2Custom"))
    story.extend(bullets([
        f"The API exposes {code('POST /jobs')}, {code('GET /jobs')}, {code('GET /jobs/:id')}, {code('GET /dlq')}, and {code('POST /dlq/:id/replay')} routes.",
        f"The queue engine stores canonical job state in {code('jobs')} and {code('dead_letters')}, while Redis sorted sets hold claimable job IDs scored by {code('available_at')} epoch milliseconds.",
        "Workers poll Redis, atomically claim jobs through Lua, mark jobs processing in PostgreSQL, run a handler, then ack or nack.",
    ]))
    story.append(source("packages/api/src/routes/jobs.ts:13,42,55; packages/api/src/routes/dlq.ts:13,26; packages/core/src/queue.ts:28,104,176,287; packages/core/src/schema.sql:7,53."))
    story.append(P("Who would use it", "H2Custom"))
    story.extend(bullets([
        "Backend services that need async, retryable work without blocking API latency.",
        "Operations teams that need to see queue depth, retry rate, worker liveness, and DLQ entries.",
        "Developers who need local Docker Compose infrastructure for demos, load tests, and interview-level system design discussion.",
    ]))
    story.append(P("What done looks like", "H2Custom"))
    story.extend(bullets([
        "A client enqueues a job and receives a job record immediately.",
        "A worker claims it once at a time, processes it, and writes final state to PostgreSQL.",
        "Successful jobs become completed with optional result JSON. Failing jobs become pending again with a delayed availability time until max attempts are exhausted. Exhausted jobs become dead and get a DLQ record.",
    ]))
    story.append(PageBreak())

    story.extend(section("2. System Architecture"))
    story.append(Diagram(kind="architecture", height=260))
    story.append(source("README.md architecture summary; docker-compose.yml:34-87; packages/core/src/redis.ts:52-67; packages/core/src/schema.sql:7-84."))
    story.append(P("Implemented components", "H2Custom"))
    story.append(table([
        ["Component", "Current implementation", "Interview defense"],
        ["API", "Fastify service on port 3000. Runs migration at startup, registers job and DLQ routes.", "Small, typed HTTP boundary. API stays thin and delegates queue semantics to core."],
        ["Core queue service", "Shared TypeScript package used by API, worker, dashboard, and loadtest.", "Keeps Redis/Postgres coordination in one place instead of duplicating queue rules."],
        ["Redis", "Sorted set per queue, priority hash per queue, per-job lock keys, reaper leader key.", "Fast atomic operations for the hot path; Lua protects claim races."],
        ["PostgreSQL", "jobs, dead_letters, worker_heartbeats, audit_log.", "Durable source of truth and easy operational queries."],
        ["Workers", "Poll loop plus semaphore; default concurrency 5; two workers intended in Compose.", "Horizontal worker scaling is just more consumers sharing Redis and Postgres."],
        ["Dashboard", "Fastify static HTML, metrics endpoint, SSE stream, DLQ replay routes.", "Operational surface for monitoring and recovery."],
    ], [82, 190, 220]))
    story.append(PageBreak())

    story.extend(section("Core Job Lifecycle"))
    story.append(Diagram(kind="sequence", height=255))
    story.append(P("Lifecycle notes", "H2Custom"))
    story.extend(bullets([
        "Enqueue: if an idempotency key exists, PostgreSQL advisory transaction lock serializes same key requests before lookup and insert.",
        "Ready scheduling: Redis sorted set score is the job's available_at timestamp. Delayed jobs simply have a future score.",
        "Claim: Lua reads up to 50 ready candidates, picks the highest numeric priority, obtains a Redis lock with PX TTL and NX, removes the job from the ready set, then TypeScript marks it processing in PostgreSQL.",
        "Success: ack updates PostgreSQL to completed, clears lock fields, deletes the Redis lock, and removes priority hash metadata.",
        "Failure: nack either reschedules with exponential backoff or moves the job to dead_letters and audit_log.",
        "Recovery: the leader reaper scans PostgreSQL for processing jobs whose locked_until is expired and re-adds them to Redis.",
    ]))
    story.append(source("packages/core/src/queue.ts:46-90,112-137,145-169,176-220,228-282,351-386; packages/core/src/lua/claim.lua:47-99."))
    story.append(PageBreak())

    story.extend(section("Key Design Decisions"))
    story.append(table([
        ["Decision", "What exists in code", "Why this design", "Trade-off / limitation"],
        ["Visibility timeout", "Claim creates Redis lock with PX TTL and sets jobs.locked_until to now + visibilityTimeoutMs. Default 30 seconds.", "Protects against worker crashes by letting expired work be reclaimed.", "No lock extension heartbeat. Long-running handlers can be requeued and processed twice."],
        ["Lua atomic claim", "claim.lua does ZRANGEBYSCORE, priority selection, SET NX PX, then ZREM as one Redis script.", "Avoids two workers seeing or claiming the same ready job between separate Redis calls.", "Atomic only inside Redis. The following PostgreSQL update is a second-store step."],
        ["Priority model", "Priority stored in queue:&lt;name&gt;:priorities hash; Lua samples up to 50 ready jobs and chooses highest priority.", "Keeps ready scheduling by time while still favoring important jobs.", "Not a perfect global priority ordering if more than 50 jobs are ready."],
        ["Backoff formula", "delay = min(baseMs * 2^attempt, capMs) + random jitter up to 25 percent. Defaults: base 1000 ms, cap 60000 ms.", "Reduces immediate retry storms and spreads failures over time.", "Jitter is random and hard to assert directly; tests cover deterministic base function."],
        ["Idempotency key", "PostgreSQL advisory transaction lock on hash(queue_name:idempotency_key), then 24-hour lookup before insert.", "Prevents concurrent duplicate enqueue requests from both passing the SELECT check.", "Dedupe is enqueue-only; does not make job handler side effects exactly once."],
        ["DLQ replay", "Replay resets original job to pending, attempts 0, clears error/locks, deletes DLQ entry, writes audit, and re-adds to Redis.", "Keeps the original job id and lets operators retry after fixing the root cause.", "Replay does not clone a new job; history is partially preserved in audit/DLQ, then DLQ row is deleted."],
    ], [78, 142, 143, 140], small=True))
    story.append(source("packages/core/src/config.ts:61-68; packages/core/src/backoff.ts:5-31; packages/core/src/queue.ts:46-58,192-213,287-342; packages/core/src/lua/claim.lua:47-99."))
    story.append(P("<b>Important honest defense:</b> You chose an at-least-once design. That is normal for background queues. The right interview language is: Redis locks reduce duplicate claims, but the system still requires idempotent handlers because crashes, expired visibility timeouts, and cross-store failures can cause re-delivery.", "Callout"))
    story.append(PageBreak())

    story.extend(section("3. Technology Stack Justification"))
    story.append(table([
        ["Technology", "Why used here", "What could have been used", "Trade-offs accepted"],
        ["Redis", "Low-latency sorted sets, hashes, TTL locks, and Lua atomicity for the hot claim path.", "RabbitMQ, Kafka, AWS SQS, BullMQ, Postgres-only queue.", "Fast but memory-bound. Single-threaded command execution per shard. Needs persistence/failover config in production."],
        ["PostgreSQL", "Durable job source of truth, JSONB payloads/results, indexes, advisory locks, audits, heartbeats, operational queries.", "MongoDB, DynamoDB, MySQL, Redis-only persistence.", "Strong consistency and SQL at the cost of write throughput and connection management."],
        ["Node.js / TypeScript", "Fastify API, async worker loop, shared typed core package, easy JSON payload handling.", "Go, Java/Kotlin, Rust, Python.", "Great I/O concurrency; CPU-heavy jobs would need separate processes or another runtime."],
        ["Docker", "Compose brings up Postgres, Redis, API, worker, dashboard with health dependencies. Dockerfile builds package-specific runtime image.", "Native local services, Kubernetes manifests, Terraform-only cloud setup.", "Great reproducibility; Compose is not the production scheduler."],
        ["Lua scripts", "Atomic multi-command Redis claim and reaper lock renewal/release compare-and-set.", "WATCH/MULTI/EXEC, Redlock library, database row locks.", "Small scripts are powerful, but must be kept simple and tested."],
        ["Fastify", "Lightweight HTTP server with route modules and logging.", "Express, NestJS, Hapi.", "Less framework structure than NestJS; validation is currently minimal."],
    ], [78, 150, 128, 150], small=True))
    story.append(source("package.json:5-18; packages/*/package.json; Dockerfile:6-59; docker-compose.yml:1-90; packages/core/src/redis.ts:52-67."))
    story.append(P("Redis vs RabbitMQ vs SQS", "H2Custom"))
    story.extend(bullets([
        "Redis fits a custom learning/project queue because sorted sets, TTL locks, and Lua let you implement delay, priority, and visibility mechanics directly.",
        "RabbitMQ gives mature broker semantics, routing, acknowledgements, and durability but less direct control over custom idempotency and Postgres-backed job state.",
        "SQS gives managed scale, visibility timeouts, and DLQs, but you give up much of the custom Redis/Lua scheduling logic and local broker behavior.",
    ]))
    story.append(P("PostgreSQL vs MongoDB", "H2Custom"))
    story.extend(bullets([
        "PostgreSQL is better for this project because job state transitions, dedupe lookups, audit queries, indexes, and transactions are central.",
        "MongoDB would be fine for flexible payload storage, but less natural for advisory locks, relational DLQ references, and aggregate operational queries.",
    ]))
    story.append(PageBreak())

    story.extend(section("4. Scalability"))
    story.append(P("Horizontal scaling model", "H2Custom"))
    story.extend(bullets([
        "Scale API tasks behind a load balancer because enqueue uses shared Redis/PostgreSQL state.",
        "Scale workers by running more worker processes. Each worker uses the same queue name and gets unique workerId from env or process defaults.",
        "Increase per-process concurrency with WORKER_CONCURRENCY, but only until downstream services, Postgres pool, and job handler latency become bottlenecks.",
        "Scale dashboard read traffic separately from write path; SSE currently polls every two seconds per connected dashboard client.",
    ]))
    story.append(table([
        ["Load", "Likely first pressure point", "Why", "Mitigation"],
        ["10x", "PostgreSQL writes and connection pool", "Every enqueue and state transition writes SQL; pool max is 20 per process.", "Tune pool, add PgBouncer, batch writes where safe, monitor slow queries."],
        ["100x", "Redis hot sorted set and Lua script", "All workers contend on queue:&lt;name&gt;; claim script scans up to 50 ready jobs.", "Shard queues, separate queues by workload, benchmark Lua latency, avoid huge ready bursts."],
        ["1000x", "Single queue architecture and cross-store consistency", "One Redis shard and one jobs table become coordination bottlenecks.", "Partition by queue or tenant, Redis Cluster/MemoryDB, Postgres partitioning, outbox/reconciler, managed queue."],
    ], [58, 132, 160, 155], small=True))
    story.append(P("Bottlenecks to name", "H2Custom"))
    story.extend(bullets([
        "Redis: single-threaded command execution per shard; Lua scripts block other Redis commands while they run.",
        "PostgreSQL: write throughput for enqueue, claim, ack/nack, heartbeat, audit, and DLQ; indexes improve reads but add write cost.",
        "Lock contention: advisory locks only affect duplicate idempotency keys, but the Redis queue key is shared by all workers for a queue.",
        "Worker runtime: Node handles I/O well, but CPU-bound handlers would block a worker process event loop.",
        "Dashboard metrics: COUNT queries over jobs can become expensive as the jobs table grows without retention or rollups.",
    ]))
    story.append(PageBreak())

    story.extend(section("Queue Sharding / Partitioning"))
    story.append(P("What sharding would look like", "H2Custom"))
    story.extend(bullets([
        "Redis key sharding: use queue:&lt;queueName&gt;:&lt;partition&gt; sorted sets and matching priority hashes. Producers choose a partition by hash of tenant, job id, or idempotency key.",
        "Worker assignment: each worker claims from one or more partitions. A simple version loops over partitions; a better version uses consistent hashing or explicit shard ownership.",
        "Postgres partitioning: partition jobs by queue_name, created_at, or hash of job id. Keep dead_letters and audit_log partitioned/retained too.",
        "Fairness: avoid one hot tenant starving others by using per-tenant queues or weighted fair scheduling.",
        "Ordering: this design does not promise strict FIFO globally. Sharding makes global ordering even less realistic, so communicate that clearly.",
    ]))
    story.append(P("What breaks if you simply add workers forever", "H2Custom"))
    story.extend(bullets([
        "More workers mean more claim calls, more lock operations, more Postgres UPDATE traffic, and more downstream pressure.",
        "Visibility timeout race gets more visible: slow jobs can be requeued while a worker still runs.",
        "Dead letter volume grows unless you add triage tooling, alerting, and retention.",
        "Backpressure is not currently enforced at the enqueue API. The API will accept work until Redis/Postgres or the process itself pushes back.",
    ]))
    story.append(source("packages/core/src/lua/claim.lua:47-99; packages/core/src/db.ts:20-22; packages/dashboard/src/routes/metrics.ts:10-49; packages/worker/src/worker.ts:25-63."))
    story.append(PageBreak())

    story.extend(section("5. AWS Deployment Mapping"))
    story.append(Diagram(kind="aws", height=260))
    story.append(P("Recommended AWS baseline", "H2Custom"))
    story.extend(bullets([
        "Compute: ECS Fargate fits this worker model best for an interview baseline. API, dashboard, and workers are already containerized, and workers are stateless apart from Redis/Postgres.",
        "Use EKS if the team already standardizes on Kubernetes or needs advanced scheduling and custom controllers. Use EC2 only if you need host-level control or cheaper long-running capacity with more operational burden.",
        "Redis: ElastiCache Redis is the default managed mapping for current Redis usage. MemoryDB is stronger when Redis durability is a primary requirement. Self-managed Redis on EC2 is educational but operationally risky.",
        "Database: RDS PostgreSQL Multi-AZ is the direct durable store. Aurora PostgreSQL becomes attractive when write/read scale, faster failover, or storage autoscaling requirements outgrow standard RDS.",
    ]))
    story.append(P("VPC, IAM, autoscaling, observability", "H2Custom"))
    story.extend(bullets([
        "VPC: public ALB subnets; private subnets for ECS tasks; isolated/private subnets for RDS and Redis; security groups allow only required ports.",
        "IAM: task execution role for pulling images and writing logs; task role for Secrets Manager/Parameter Store access; least-privilege database and Redis credentials.",
        "Autoscaling: API scales on CPU/request count/latency; workers scale on queue depth, age of oldest job, jobs per worker, and DLQ/retry rate; dashboard stays small.",
        "Observability: CloudWatch logs and alarms at minimum; X-Ray/OpenTelemetry for request traces; Prometheus/Grafana equivalent if self-hosting metrics.",
    ]))
    story.append(PageBreak())

    story.extend(section("SQS + DLQ Alternative"))
    story.append(table([
        ["If replaced with SQS + DLQ", "Gain", "Lose / rewrite"],
        ["Queueing", "Managed availability, throughput scaling, visibility timeout, redrive policy.", "Custom Redis sorted set scheduling and Lua claim logic."],
        ["Retries", "Native receive count and DLQ redrive can cover basic retry exhaustion.", "Your exact backoff formula and priority sampling unless implemented outside SQS."],
        ["Priority", "Could use multiple queues per priority tier.", "Single-queue numeric priority behavior from Redis hash and Lua selection."],
        ["Idempotency", "FIFO queues provide message dedup windows; Standard queues need app-level dedupe.", "Your 24-hour PostgreSQL advisory-lock dedupe behavior unless retained."],
        ["Durable state", "SQS stores messages, reducing custom broker ops.", "PostgreSQL job ledger still needed if you want rich status queries, dashboard history, audit, replay semantics."],
        ["Ops", "Less Redis management; AWS handles broker scaling.", "Less opportunity to demonstrate low-level queue mechanics in this project."],
    ], [130, 180, 190], small=True))
    story.append(P("Best interview framing", "H2Custom"))
    story.extend(bullets([
        "I would use SQS for a production system if the business need is reliable managed queueing more than custom queue semantics.",
        "I built this Redis/Postgres design to demonstrate the mechanics SQS abstracts away: visibility timeouts, atomic claims, retry scheduling, dead letter replay, and idempotency.",
        "If migrating to SQS, I would likely keep PostgreSQL for job metadata, audit, dashboard, idempotency keys, and application-level replay records.",
    ]))
    story.append(PageBreak())

    story.extend(section("6. Production Readiness"))
    story.append(P("What is missing right now", "H2Custom"))
    story.append(table([
        ["Area", "Current state", "Not yet implemented / suggested extension"],
        ["Monitoring", "Dashboard has queue depth, jobs/sec estimate, retry rate, DLQ size, worker liveness.", "Prometheus/OpenTelemetry metrics, RED/USE dashboards, queue age, claim latency, handler duration histograms."],
        ["Alerting", "No alert rules in repo.", "DLQ growth, retry spike, no alive workers, old pending jobs, Redis/Pg connection failures, stale locks."],
        ["Backpressure", "API validates required fields but no rate limit or queue-depth rejection.", "Rate limiting, max queue depth, per-tenant quotas, 429/503 behavior."],
        ["Graceful shutdown", "Worker stops claiming and waits up to 30 seconds for in-flight jobs.", "Long-running job lock extension; SIGTERM tests; Kubernetes preStop/readiness drain."],
        ["Failover", "ioredis reconnects; Pg pool logs errors. Compose has health checks.", "Redis HA, RDS Multi-AZ, retry policies around failed writes, reconciler for Redis/Postgres divergence."],
        ["Security", "Local hardcoded Compose credentials, CORS origin true, no API auth.", "Secrets Manager, authN/authZ, TLS, private networking, input schema validation, least-privilege DB user."],
        ["Testing", "Backoff unit tests pass; integration tests exist but are env-gated.", "Always-on CI integration tests with ephemeral Redis/Pg, chaos tests, failover tests, race tests."],
    ], [80, 190, 230], small=True))
    story.append(source("packages/worker/src/shutdown.ts:1-45; packages/core/src/redis.ts:17-24; docker-compose.yml:15-29; packages/dashboard/src/routes/metrics.ts:10-49; test result: 2 passed, 3 skipped on 2026-08-07."))
    story.append(PageBreak())

    story.extend(section("Failover and Data Safety"))
    story.append(P("Redis failover", "H2Custom"))
    story.extend(bullets([
        "Current behavior: ioredis reconnects with a capped retry strategy. Redis locks are TTL-based, so some in-flight state can naturally expire.",
        "Risk: Redis is not the durable source of truth in this design, but the ready queue is in Redis. If Redis loses sorted set data, pending jobs can exist in PostgreSQL but not be claimable.",
        "Production answer: enable managed Redis HA/persistence, add a reconciler that periodically re-adds PostgreSQL pending jobs whose available_at &lt;= now and are missing from Redis, and use an outbox pattern for enqueue.",
    ]))
    story.append(P("PostgreSQL failover", "H2Custom"))
    story.extend(bullets([
        "Current behavior: Pool errors are logged; SQL operations fail back to callers or worker loop error handling.",
        "Risk: a Redis claim can succeed while the PostgreSQL processing update fails, leaving the job removed from Redis until a reconciler fixes it.",
        "Production answer: RDS Multi-AZ/Aurora, conservative retry policy, idempotent SQL updates with locked_by checks, and a reconciliation job that treats PostgreSQL as source of truth.",
    ]))
    story.append(P("Security posture", "H2Custom"))
    story.extend(bullets([
        "Secrets: move DATABASE_URL and REDIS_URL credentials out of Compose literals into AWS Secrets Manager or Parameter Store.",
        "Network: expose only ALB/API/dashboard as needed; keep Redis and PostgreSQL private.",
        "Least privilege: separate DB users for migrations, API, workers, and dashboard if this became production.",
        "Input safety: add JSON schema validation for payload size, priority range, max_attempts, delay_ms, and idempotency key length.",
    ]))
    story.append(PageBreak())

    story.extend(section("7. Workflow / Operational Flow"))
    story.append(Diagram(kind="deploy", height=235))
    story.append(P("Current local flow", "H2Custom"))
    story.extend(bullets([
        f"Run full local stack with {code('docker compose up --build')}. Compose defines Postgres, Redis, API, worker, and dashboard services.",
        "Postgres uses a named volume pgdata. Redis has no named persistence volume in Compose.",
        "The API and dashboard listen on 3000 and 3001. Redis is published locally as 6380 while containers use redis:6379.",
        "The Dockerfile is package-parameterized with PACKAGE_NAME and compiles core plus the selected package into a runtime image.",
    ]))
    story.append(source("README.md Run With Docker; docker-compose.yml:5-90; Dockerfile:25-59; package.json:9-18."))
    story.append(P("Docker Compose to production path", "H2Custom"))
    story.extend(bullets([
        "Step 1: keep the same env contract: DATABASE_URL, REDIS_URL, HOST, PORT, QUEUE_NAME, WORKER_CONCURRENCY, VISIBILITY_TIMEOUT_MS.",
        "Step 2: build and push separate API, worker, and dashboard images from the same Dockerfile with different PACKAGE_NAME args.",
        "Step 3: deploy API and dashboard behind ALB; deploy workers as private services with no public ingress.",
        "Step 4: replace Compose Postgres/Redis with RDS and ElastiCache/MemoryDB; run migrations through a controlled release job.",
        "Step 5: add autoscaling, alerts, dashboard auth, secret injection, and rollback strategy.",
    ]))
    story.append(PageBreak())

    story.extend(section("8. Specific Gotcha Questions"))
    gotchas = [
        ("Is this exactly-once?", "No. It is an at-least-once queue. Redis locks and Lua reduce duplicate claims, but crashes and visibility expiry can re-deliver work. Handlers must be idempotent."),
        ("What happens if a job runs longer than 30 seconds?", "Default visibilityTimeoutMs is 30000. There is no lock extension, so the reaper may requeue the job while the original worker still runs."),
        ("Can Redis and PostgreSQL get out of sync?", "Yes. Enqueue, claim, ack, and nack coordinate two stores without a distributed transaction. A production version needs outbox/reconciliation."),
        ("What if Redis loses its data?", "PostgreSQL still has job records, but pending jobs may be missing from Redis and not claimable until a reconciler rehydrates the sorted sets. That reconciler is not implemented."),
        ("Why Lua instead of MULTI/EXEC?", "The script keeps candidate lookup, priority choice, lock acquire, and removal together in one server-side atomic operation with no client round trips between steps."),
        ("Does priority guarantee strict global priority?", "No. Lua samples up to 50 ready jobs and chooses the highest priority within that batch. It is priority-biased, not a strict global priority scheduler."),
        ("How does the idempotency window work?", "For same queue_name and idempotency_key, the code checks jobs created in the last 24 hours. Advisory lock serializes concurrent same-key requests."),
        ("Does idempotency dedupe completed side effects?", "No. It only dedupes enqueue requests. The worker handler must make external side effects idempotent."),
        ("What happens after max attempts?", "nack moves the job to status dead, inserts dead_letters, writes audit_log, clears locks, and removes Redis metadata."),
        ("Is the DLQ failure history complete?", "Not fully. moveToDLQ currently creates a failureHistory array with the final failure; a history query exists but is not used to build multi-attempt history."),
        ("Why is status failed in the schema?", "The schema allows failed, but current nack logic uses pending for retry and dead for exhausted jobs. failed is not actively used."),
        ("Can any worker ack a job?", "QueueService.ack updates by job id only and does not check locked_by or lock ownership. Production should verify ownership."),
        ("What if the worker crashes after Redis claim but before PostgreSQL update?", "The job can be removed from Redis while still pending in PostgreSQL. The current reaper only checks processing jobs, so this needs reconciliation."),
        ("Can the reaper race with a slow worker ack?", "Yes. Reaper UPDATE has a status guard, but the code does not check affected rows before re-adding to Redis. This is a limitation to fix."),
        ("How does graceful shutdown work?", "The worker sets a draining flag, stops new claims, waits up to 30 seconds for active jobs, stops heartbeat/reaper, closes Redis and Postgres."),
        ("What is the bottleneck at high load?", "Likely PostgreSQL write throughput and Redis hot queue key contention, then dashboard aggregate COUNT queries as history grows."),
        ("How would you scale workers?", "Run more worker tasks and/or increase WORKER_CONCURRENCY. Then add queue sharding and autoscale on queue depth and oldest job age."),
        ("Why not use SQS?", "For production simplicity I might. This project intentionally implements the queue mechanics itself to show atomic claims, backoff, DLQ replay, and idempotency."),
        ("Are integration tests always run?", "No. Redis/Postgres tests are skipped unless RUN_INTEGRATION_TESTS=1. The default npm test run passed only the non-integration backoff tests today."),
        ("Is Compose production-ready?", "No. It is a local demo/development stack. Production needs managed Redis/Postgres, secrets, private networking, autoscaling, alerts, and CI/CD."),
    ]
    story.append(table([["Question", "Concise honest answer"]] + gotchas[:10], [155, 345], small=True))
    story.append(PageBreak())
    story.extend(section("Gotcha Questions Continued"))
    story.append(table([["Question", "Concise honest answer"]] + gotchas[10:], [155, 345], small=True))
    story.append(source("Key limitations grounded in packages/core/src/queue.ts:112-137,145-169,228-282,351-386; packages/core/src/lua/claim.lua:47-99; packages/worker/src/shutdown.ts:1-45; packages/core/src/schema.sql:12."))
    story.append(PageBreak())

    story.extend(section("One-Hour Talk Track"))
    story.append(table([
        ["Minutes", "Topic", "What to emphasize"],
        ["0-5", "Problem and goal", "Background work, retryable failures, durable state, operator recovery."],
        ["5-12", "Architecture", "API, Redis, PostgreSQL, workers, dashboard, reaper; draw data flow."],
        ["12-22", "Job lifecycle", "Enqueue, idempotency, Redis scheduling, Lua claim, ack/nack, backoff, DLQ."],
        ["22-32", "Reliability mechanics", "Visibility timeout, leader-elected reaper, at-least-once semantics, graceful shutdown."],
        ["32-40", "Data model", "jobs, dead_letters, worker_heartbeats, audit_log, indexes, why SQL."],
        ["40-48", "Scale", "Workers horizontally, bottlenecks, Redis hot key, Pg writes, partitioning strategy."],
        ["48-55", "AWS", "ECS Fargate, ALB, ElastiCache/MemoryDB, RDS/Aurora, CloudWatch, IAM, VPC."],
        ["55-60", "Limitations and next steps", "Cross-store consistency, reconciler/outbox, lock ownership, long job heartbeat, CI integration tests."],
    ], [60, 125, 315]))
    story.append(P("A strong closing sentence", "H2Custom"))
    story.append(P("This project is not trying to outdo SQS or RabbitMQ. It is a hands-on implementation of the reliability primitives those systems expose: atomic claiming, visibility timeouts, retry backoff, durable job state, and dead letter recovery. I can explain where it works, where it is intentionally simplified, and how I would harden it for production.", "Callout"))
    story.append(PageBreak())

    story.extend(section("Cheat Sheet"))
    story.append(P("Core answer", "H2Custom"))
    story.extend(bullets([
        "System: Fastify API + Redis hot queue + PostgreSQL durable state + worker processes + dashboard + leader-elected reaper.",
        "Guarantee: at-least-once processing. Idempotency key dedupes enqueue for 24 hours, not job side effects.",
        "Redis keys: queue:&lt;name&gt; sorted set; queue:&lt;name&gt;:priorities hash; queue:lock:&lt;jobId&gt; TTL lock; reliable-queue:reaper:leader.",
        "Backoff: min(base * 2^attempt, cap) + random jitter up to 25 percent. Defaults base 1s, cap 60s.",
        "Visibility timeout: default 30s; lock TTL plus jobs.locked_until. Reaper scans expired processing jobs.",
        "DLQ: exhausted jobs get status dead, dead_letters row, audit_log row, and can be replayed.",
    ]))
    story.append(P("Defend the stack", "H2Custom"))
    story.extend(bullets([
        "Redis over RabbitMQ/SQS for custom mechanics and Lua atomicity in a learning/custom queue.",
        "PostgreSQL over MongoDB for transactions, advisory locks, indexes, audits, and operational SQL.",
        "TypeScript/Node for typed shared packages and I/O-heavy worker/API code.",
        "Docker Compose for repeatable local infra; ECS Fargate + RDS + ElastiCache is the clean AWS mapping.",
    ]))
    story.append(P("Do not overclaim", "H2Custom"))
    story.extend(bullets([
        "No exactly-once processing.",
        "No lock extension for long jobs.",
        "No cross-store transaction between Redis and PostgreSQL.",
        "No reconciler for pending jobs missing from Redis.",
        "No production auth, rate limiting, secrets manager, CI workflow, or full monitoring/alerting in repo.",
        "Integration tests exist but were skipped in the default test run unless RUN_INTEGRATION_TESTS=1.",
    ]))
    story.append(P("Best next improvements", "H2Custom"))
    story.extend(bullets([
        "Add outbox/reconciler to repair Redis from PostgreSQL.",
        "Add lock ownership checks to ack/nack and reaper rowCount checks.",
        "Add visibility lock extension heartbeat for long-running jobs.",
        "Add schema validation, auth, rate limiting, OpenTelemetry metrics, alerting, and always-on integration tests.",
    ]))
    story.append(source("Cheat sheet sources: packages/core/src/config.ts:61-68; packages/core/src/redis.ts:52-67; packages/core/src/backoff.ts:20-31; packages/core/src/queue.ts:28-386; packages/worker/src/reaper.ts:79-172."))

    return story


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    doc = SimpleDocTemplate(
        OUT,
        pagesize=letter,
        rightMargin=0.55 * inch,
        leftMargin=0.55 * inch,
        topMargin=0.62 * inch,
        bottomMargin=0.55 * inch,
        title="Reliable Job Queue Study Guide",
        author="Codex",
    )
    story = build_story()
    doc.build(story, onFirstPage=page_header_footer, onLaterPages=page_header_footer)
    print(OUT)


if __name__ == "__main__":
    main()
