// Find the `if (req.method === 'GET')` block and update it to this:
if (req.method === 'GET') {
    // ADD THESE TWO LINES
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');

    const { userId, type } = req.query;
    const key = `status_${userId}_${type}`;
    
    try {
        const status = await kv.get(key) || 'pending';
        if (status !== 'pending') {
            await kv.del(key);
        }
        return res.status(200).json({ status: status });
    } catch (error) {
        return res.status(200).json({ status: 'pending' }); 
    }
}
