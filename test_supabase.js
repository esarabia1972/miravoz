const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://bpcedvpcwwwgnfinqztq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_dqFw8-mzNW88E5aRgG7WMw_byIf-pT1';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function test() {
    const email = `test_1728498801931@test.com`; // the one created earlier? Actually I will just create a new one.
    const newEmail = `test_${Date.now()}@test.com`;
    console.log("Signing up...");
    const { data: authData } = await supabase.auth.signUp({ email: newEmail, password: 'password123' });
    
    console.log("Creating user...");
    const { data: newUser } = await supabase
        .from('aac_users')
        .insert([{ professional_id: authData.user.id, display_name: 'Test Patient' }])
        .select().single();
        
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 10);
    
    console.log("Inserting access code...");
    const { error: codeError } = await supabase
        .from('access_codes')
        .insert([{
            code: '123-458',
            aac_user_id: newUser.id,
            expires_at: expiresAt.toISOString()
        }]);
        
    if (codeError) {
        console.error("Exact codeError:", JSON.stringify(codeError, null, 2));
    } else {
        console.log("Insert successful!");
    }
}

test();
