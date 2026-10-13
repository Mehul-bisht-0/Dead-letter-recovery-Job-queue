-- Redis provides only a scheduling hint; PostgreSQL grants the fenced lease.
-- All ten keys share a hash tag. Priority is strict among currently ready hints.
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
for i = 1, #KEYS do
  local ready = redis.call('ZRANGEBYSCORE', KEYS[i], '-inf', now, 'LIMIT', 0, 1)
  if #ready > 0 then
    redis.call('ZREM', KEYS[i], ready[1])
    return ready[1]
  end
end
return nil
