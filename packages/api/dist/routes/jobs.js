"use strict";
// ---------------------------------------------------------------------------
// /jobs routes — enqueue, query status, list
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerJobRoutes = registerJobRoutes;
function registerJobRoutes(app, queue) {
    // -----------------------------------------------------------------------
    // POST /jobs — Enqueue a new job
    // -----------------------------------------------------------------------
    app.post('/jobs', async (request, reply) => {
        const body = request.body;
        if (!body || !body.queue_name || !body.payload) {
            return reply.status(400).send({
                error: 'Missing required fields: queue_name, payload',
            });
        }
        const options = {
            queue_name: body.queue_name,
            payload: body.payload,
            priority: body.priority ?? 5,
            delay_ms: body.delay_ms,
            max_attempts: body.max_attempts ?? 3,
            idempotency_key: body.idempotency_key,
        };
        const result = await queue.enqueue(options);
        return reply.status(result.created ? 201 : 200).send({
            job: result.job,
            created: result.created,
        });
    });
    // -----------------------------------------------------------------------
    // GET /jobs/:id — Get a single job by ID
    // -----------------------------------------------------------------------
    app.get('/jobs/:id', async (request, reply) => {
        const job = await queue.getJob(request.params.id);
        if (!job) {
            return reply.status(404).send({ error: 'Job not found' });
        }
        return reply.send({ job });
    });
    // -----------------------------------------------------------------------
    // GET /jobs — List jobs with optional filters
    // -----------------------------------------------------------------------
    app.get('/jobs', async (request, reply) => {
        const { queue_name, status, limit, offset } = request.query;
        const result = await queue.listJobs({
            queue_name,
            status,
            limit: limit ? parseInt(limit, 10) : 50,
            offset: offset ? parseInt(offset, 10) : 0,
        });
        return reply.send(result);
    });
}
//# sourceMappingURL=jobs.js.map