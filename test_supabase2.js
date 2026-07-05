const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = 'https://bpcedvpcwwwgnfinqztq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_dqFw8-mzNW88E5aRgG7WMw_byIf-pT1';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

supabase.auth.onAuthStateChange((event, session) => {
    console.log("AUTH EVENT FIRED:", event);
});

(async () => {
  console.log("Attempting sign up...");
  const { data: suData, error: suError } = await supabase.auth.signUp({
    email: 'test_node_43@test.com',
    password: 'password123'
  });
  
  console.log("Attempting sign in AGAIN...");
  const { data: siData, error: siError } = await supabase.auth.signInWithPassword({
    email: 'test_node_43@test.com',
    password: 'password123'
  });
  
  await new Promise(r => setTimeout(r, 1000));
})();
