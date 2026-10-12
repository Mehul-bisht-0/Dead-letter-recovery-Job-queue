"use strict";
// ---------------------------------------------------------------------------
// DLQ routes for the dashboard
// ---------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerDLQRoutes = registerDLQRoutes;
function registerDLQRoutes(app, queue) {
    app.get('/api/dlq', async (request, reply) => {
        const limit = request.query.limit ? parseInt(request.query.limit, 10) : 20;
        const offset = request.query.offset ? parseInt(request.query.offset, 10) : 0;
        const result = await queue.listDeadLetters(limit, offset);
        return reply.send(result);
    });
    app.post('/api/dlq/:id/replay', async (request, reply) => {
        try {
            const job = await queue.replayFromDLQ(request.params.id);
            return reply.status(200).send({ success: true, job });
        }
        catch (err) {
            return reply.status(400).send({ success: false, error: err.message });
        }
    });
}
//# sourceMappingURL=dlq.js.map