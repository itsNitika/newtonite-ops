import crypto from 'crypto';
export function idempotencyMiddleware(req, res, next) {
    // Only apply to mutating HTTP methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        next();
        return;
    }
    const idempotencyKey = req.headers['idempotency-key'];
    if (!idempotencyKey) {
        // If client didn't supply idempotency key, proceed normally
        next();
        return;
    }
    const userId = req.user?.id || 'anonymous';
    const requestPath = req.originalUrl || req.url;
    const payloadString = JSON.stringify({
        method: req.method,
        url: requestPath,
        body: req.body || {}
    });
    const requestHash = crypto.createHash('sha256').update(payloadString).digest('hex');
    const db = req.db;
    const selectStmt = db.prepare('SELECT * FROM idempotency_records WHERE idempotency_key = ?');
    const existing = selectStmt.get(idempotencyKey);
    if (existing) {
        // Check hash mismatch
        if (existing.request_hash !== requestHash) {
            res.status(422).json({
                error: 'Idempotency conflict: this Idempotency-Key was previously used with a different request payload.'
            });
            return;
        }
        if (existing.status === 'PROCESSING') {
            res.status(409).json({
                error: 'A request with this Idempotency-Key is currently in progress. Please wait before retrying.'
            });
            return;
        }
        if (existing.status === 'COMPLETED' && existing.response_status && existing.response_body) {
            res.setHeader('X-Idempotent-Replay', 'true');
            res.status(existing.response_status);
            try {
                const parsed = JSON.parse(existing.response_body);
                res.json(parsed);
            }
            catch {
                res.send(existing.response_body);
            }
            return;
        }
    }
    // Record initial PROCESSING state
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    try {
        const insertStmt = db.prepare(`
      INSERT INTO idempotency_records (
        idempotency_key, user_id, request_path, request_hash, status, created_at, expires_at
      ) VALUES (?, ?, ?, ?, 'PROCESSING', ?, ?)
    `);
        insertStmt.run(idempotencyKey, userId, requestPath, requestHash, now, expiresAt);
    }
    catch (err) {
        // Race condition on insert
        const doubleCheck = selectStmt.get(idempotencyKey);
        if (doubleCheck && doubleCheck.status === 'COMPLETED' && doubleCheck.response_status && doubleCheck.response_body) {
            res.setHeader('X-Idempotent-Replay', 'true');
            res.status(doubleCheck.response_status);
            res.json(JSON.parse(doubleCheck.response_body));
            return;
        }
        res.status(409).json({ error: 'Concurrent conflicting request detected' });
        return;
    }
    // Intercept response to store completed payload
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    res.json = function (body) {
        try {
            const updateStmt = db.prepare(`
        UPDATE idempotency_records 
        SET status = 'COMPLETED', response_status = ?, response_body = ? 
        WHERE idempotency_key = ?
      `);
            updateStmt.run(res.statusCode, JSON.stringify(body), idempotencyKey);
        }
        catch (e) {
            console.error('Error saving idempotency response JSON:', e);
        }
        return originalJson(body);
    };
    res.send = function (body) {
        try {
            const updateStmt = db.prepare(`
        UPDATE idempotency_records 
        SET status = 'COMPLETED', response_status = ?, response_body = ? 
        WHERE idempotency_key = ?
      `);
            const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
            updateStmt.run(res.statusCode, bodyStr, idempotencyKey);
        }
        catch (e) {
            console.error('Error saving idempotency response Send:', e);
        }
        return originalSend(body);
    };
    next();
}
