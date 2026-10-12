"use strict";
// ---------------------------------------------------------------------------
// /dlq routes — list dead-letter entries, replay
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerDLQRoutes = registerDLQRoutes;
function registerDLQRoutes(app, queue) {
    // -----------------------------------------------------------------------
    // GET /dlq — List dead letter entries
    // -----------------------------------------------------------------------
    app.get('/dlq', async (request, reply) => {
        const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
        const offset = request.query.offset ? parseInt(request.query.offset, 10) : 0;
        const result = await queue.listDeadLetters(limit, offset);
        return reply.send(result);
    });
    // -----------------------------------------------------------------------
    // POST /dlq/:id/replay — Re-enqueue a dead-lettered job
    // -----------------------------------------------------------------------
    app.post('/dlq/:id/replay', async (request, reply) => {
        try {
            const job = await queue.replayFromDLQ(request.params.id);
            return reply.status(200).send({
                message: 'Job replayed successfully',
                job,
            });
        }
        catch (err) {
            if (err.message?.includes('not found')) {
                return reply.status(404).send({ error: err.message });
            }
            throw err;
        }
    });
}
//# sourceMappingURL=dlq.js.map