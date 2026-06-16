const { getSupabase } = require('./supabase');

async function getUserById(userId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('users')
    .select('id, phone, role, created_at, updated_at')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function upsertUserPhone(userId, phone) {
  const supabase = getSupabase();
  const { error } = await supabase.from('users').upsert(
    {
      id: userId,
      phone,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );

  if (error) throw error;
}

async function setUserRole(userId, role) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('users')
    .update({ role, updated_at: new Date().toISOString() })
    .eq('id', userId);

  if (error) throw error;
}

module.exports = { getUserById, upsertUserPhone, setUserRole };
