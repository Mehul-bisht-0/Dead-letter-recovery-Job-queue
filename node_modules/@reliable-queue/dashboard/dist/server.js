"use strict";
// ---------------------------------------------------------------------------
// Dashboard server — serves metrics API, SSE, and static frontend
// ---------------------------------------------------------------------------
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const static_1 = __importDefault(require("@fastify/static"));
const path_1 = __importDefault(require("path"));
const core_1 = require("@reliable-queue/core");
const metrics_1 = require("./routes/metrics");
const dlq_1 = require("./routes/dlq");
async function main() {
    const config = (0, core_1.loadConfig)({ port: parseInt(process.env.PORT || '3001', 10) });
    await (0, core_1.migrate)(config);
    const pool = (0, core_1.getPool)(config);
    const redis = (0, core_1.getRedis)(config);
    const queueService = new core_1.QueueService(pool, redis);
    const app = (0, fastify_1.default)({ logger: true });
    await app.register(cors_1.default, { origin: true });
    // Serve static HTML frontend
    await app.register(static_1.default, {
        root: path_1.default.join(__dirname, '..', 'public'),
        prefix: '/',
    });
    // Register API routes
    (0, metrics_1.registerMetricsRoutes)(app, queueService, pool);
    (0, dlq_1.registerDLQRoutes)(app, queueService);
    // Start listening
    await app.listen({ host: config.host, port: config.port });
    console.log(`[dashboard] Server listening on ${config.host}:${config.port}`);
    // Graceful shutdown
    const shutdown = async () => {
        console.log('[dashboard] Shutting down...');
        await app.close();
        await (0, core_1.closeRedis)();
        await (0, core_1.closePool)();
        process.exit(0);
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}
main().catch((err) => {
    console.error('[dashboard] Fatal error:', err);
    process.exit(1);
});
//# sourceMappingURL=server.js.map