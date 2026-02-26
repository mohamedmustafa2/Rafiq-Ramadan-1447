const crypto = require('crypto');

// Helper to hash passwords
const hashPassword = (password) => crypto.createHash('sha256').update(password).digest('hex');

// Helper to parse body
const parseBody = (event) => {
  try {
    return JSON.parse(event.body || '{}');
  } catch {
    return {};
  }
};

// Helper to send JSON response
const response = (statusCode, body) => ({
  statusCode,
  headers: { 
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  },
  body: JSON.stringify(body)
});

exports.handler = async (event, context) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return response(200, {});
  }

  const { store } = context;
  const path = event.path.replace('/.netlify/functions/api', '').replace('/api', '');
  const data = parseBody(event);
  
  try {
    // --- REGISTER ---
    if (path === '/register' && event.httpMethod === 'POST') {
      const { name, email, password } = data;
      
      if (!name || !email || !password) {
        return response(400, { success: false, message: 'جميع الحقول مطلوبة' });
      }
      if (password.length < 6) {
        return response(400, { success: false, message: 'كلمة المرور قصيرة' });
      }

      const userKey = `user:${email.toLowerCase()}`;
      const existingUser = await store.get(userKey);
      
      if (existingUser) {
        return response(400, { success: false, message: 'البريد مسجل مسبقاً' });
      }

      // Check for duplicate name
      const { blobs } = await store.list({ prefix: 'user:' });
      for (const blob of blobs) {
        const u = JSON.parse(await store.get(blob.key));
        if (u && u.name === name) {
          return response(400, { success: false, message: 'الاسم مستخدم' };
        }
      }

      const newUser = {
        id: Date.now().toString(),
        name,
        email: email.toLowerCase(),
        password: hashPassword(password),
        total_points: 0,
        records: {},
        join_date: new Date().toISOString()
      };

      await store.set(userKey, JSON.stringify(newUser));
      
      const { password: pwd, ...userWithoutPassword } = newUser;
      return response(200, { success: true, user: userWithoutPassword });
    }

    // --- LOGIN ---
    if (path === '/login' && event.httpMethod === 'POST') {
      const { email, password } = data;
      
      if (!email || !password) {
        return response(400, { success: false, message: 'بيانات ناقصة' });
      }

      const userKey = `user:${email.toLowerCase()}`;
      const userData = await store.get(userKey);
      
      if (!userData) {
        return response(401, { success: false, message: 'بيانات خاطئة' });
      }

      const user = JSON.parse(userData);
      
      if (user.password !== hashPassword(password)) {
        return response(401, { success: false, message: 'بيانات خاطئة' });
      }

      const { password: pwd, ...userWithoutPassword } = user;
      return response(200, { success: true, user: userWithoutPassword });
    }

    // --- SAVE DAY ---
    if (path === '/save_day' && event.httpMethod === 'POST') {
      const { user_id, date, day_data } = data;
      
      if (!user_id || !date || !day_data) {
        return response(400, { success: false, message: 'بيانات ناقصة' });
      }

      // Find user by ID
      const { blobs } = await store.list({ prefix: 'user:' });
      let userKey = null;
      let user = null;

      for (const blob of blobs) {
        const u = JSON.parse(await store.get(blob.key));
        if (u.id === user_id) {
          user = u;
          userKey = blob.key;
          break;
        }
      }

      if (!user) {
        return response(404, { success: false, message: 'مستخدم غير موجود' });
      }

      user.records = user.records || {};
      user.records[date] = day_data;

      // Calculate total
      let total = 0;
      Object.values(user.records).forEach(day => {
        Object.values(day).forEach(item => {
          if (item && item.points) total += item.points;
        });
      });
      user.total_points = total;

      await store.set(userKey, JSON.stringify(user));

      return response(200, { success: true, total_points: total });
    }

    // --- GET USER ---
    if (path.startsWith('/get_user/') && event.httpMethod === 'GET') {
      const userId = path.replace('/get_user/', '');
      
      const { blobs } = await store.list({ prefix: 'user:' });
      
      for (const blob of blobs) {
        const u = JSON.parse(await store.get(blob.key));
        if (u.id === userId) {
          const { password, ...userWithoutPassword } = u;
          return response(200, { success: true, user: userWithoutPassword });
        }
      }
      
      return response(404, { success: false, message: 'غير موجود' });
    }

    // --- LEADERBOARD ---
    if (path === '/leaderboard' && event.httpMethod === 'GET') {
      const { blobs } = await store.list({ prefix: 'user:' });
      const users = [];

      for (const blob of blobs) {
        const u = JSON.parse(await store.get(blob.key));
        users.push({
          id: u.id,
          name: u.name,
          total_points: u.total_points || 0
        });
      }

      users.sort((a, b) => b.total_points - a.total_points);
      
      return response(200, { success: true, leaderboard: users });
    }

    // --- CHANGE PASSWORD ---
    if (path === '/change_password' && event.httpMethod === 'POST') {
      const { email, new_password } = data;
      
      if (!email || !new_password || new_password.length < 6) {
        return response(400, { success: false, message: 'بيانات غير صالحة' });
      }

      const userKey = `user:${email.toLowerCase()}`;
      const userData = await store.get(userKey);
      
      if (!userData) {
        return response(404, { success: false, message: 'البريد غير موجود' });
      }

      const user = JSON.parse(userData);
      user.password = hashPassword(new_password);
      
      await store.set(userKey, JSON.stringify(user));
      
      return response(200, { success: true, message: 'تم التغيير' });
    }

    // --- ROOT ---
    if (path === '/' || path === '') {
      return response(200, { status: 'running', message: 'Ramadan API (Netlify)' });
    }

    return response(404, { success: false, message: 'Not Found' });

  } catch (error) {
    console.error('Error:', error);
    return response(500, { success: false, message: 'خطأ في السيرفر' });
  }
};