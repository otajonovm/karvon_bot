const { getSupabase } = require('./supabase');
const { ROLES } = require('../config/constants');
const { upsertUserPhone, setUserRole } = require('./users');

async function getBrokerByUserId(userId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('brokers')
    .select('user_id, phone')
    .eq('user_id', userId)
    .maybeSingle();

  if (error && !/brokers|relation|schema/i.test(error.message)) throw error;
  return data;
}

async function ensureBroker(userId, phone) {
  await upsertUserPhone(userId, phone);
  await setUserRole(userId, ROLES.CLIENT);

  const supabase = getSupabase();
  const { error } = await supabase.from('brokers').upsert(
    {
      user_id: userId,
      phone,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );

  if (error && !/brokers|relation|schema/i.test(error.message)) throw error;
}

module.exports = { getBrokerByUserId, ensureBroker };
