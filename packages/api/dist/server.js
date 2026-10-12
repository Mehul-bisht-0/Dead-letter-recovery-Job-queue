"use strict";
// ---------------------------------------------------------------------------
// Fastify API server — entry point for the HTTP API service
// ---------------------------------------------------------------------------
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const core_1 = require("@reliable-queue/core");
const jobs_1 = require("./routes/jobs");
const dlq_1 = require("./routes/dlq");
async function main() {
    const config = (0, core_1.loadConfig)();
    // Run schema migration before starting the server
    await (0, core_1.migrate)(config);
    const pool = (0, core_1.getPool)(config);
    const redis = (0, core_1.getRedis)(config);
    const queueService = new core_1.QueueService(pool, redis);
    const app = (0, fastify_1.default)({ logger: true });
    await app.register(cors_1.default, { origin: true });
    // Health check
    app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));
    // Register route modules
    (0, jobs_1.registerJobRoutes)(app, queueService);
    (0, dlq_1.registerDLQRoutes)(app, queueService);
    // Start listening
    await app.listen({ host: config.host, port: config.port });
    console.log(`[api] Server listening on ${config.host}:${config.port}`);
    // Graceful shutdown
    const shutdown = async () => {
        console.log('[api] Shutting down...');
        await app.close();
        await (0, core_1.closeRedis)();
        await (0, core_1.closePool)();
        process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}
main().catch((err) => {
    console.error('[api] Fatal error:', err);
    process.exit(1);
});
//# sourceMappingURL=server.js.map