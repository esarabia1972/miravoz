const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = 'https://bpcedvpcwwwgnfinqztq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_dqFw8-mzNW88E5aRgG7WMw_byIf-pT1';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

(async () => {
  console.log("Attempting sign up...");
  const { data: suData, error: suError } = await supabase.auth.signUp({
    email: 'test_node_42@test.com',
    password: 'password123'
  });
  console.log("SignUp Error:", suError);
  console.log("SignUp Data session?", !!suData?.session);
  
  if (!suError) {
      console.log("Attempting sign in...");
      const { data: siData, error: siError } = await supabase.auth.signInWithPassword({
        email: 'test_node_42@test.com',
        password: 'password123'
      });
      console.log("SignIn Error:", siError);
      console.log("SignIn Data session?", !!siData?.session);
  }
})();
