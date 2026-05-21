import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const reqBody = await req.json();
        const { nomor_antrian, amount, customer_name, customer_email, customer_phone, channel_code, return_url } = reqBody;

        if (!nomor_antrian || !amount) {
            return new Response(JSON.stringify({ error: 'nomor_antrian and amount are required' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400,
            });
        }

        // Setup Supabase Client
        const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
        const supabaseServiceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
        const supabase = createClient(supabaseUrl, supabaseServiceRole);

        // Fetch Paymenku API Key
        const paymenkuApiKey = Deno.env.get('PAYMENKU_API_KEY');
        if (!paymenkuApiKey) {
            throw new Error('PAYMENKU_API_KEY is not set');
        }

        // Payload for Paymenku
        const payload = {
            reference_id: nomor_antrian,
            amount: amount,
            customer_name: customer_name || 'Customer',
            customer_email: customer_email || 'no-reply@antriphotobooth.com',
            customer_phone: customer_phone || '08000000000',
            channel_code: channel_code || 'qris', // Default to QRIS if not provided
            return_url: return_url || 'https://example.com/payment-return' // Will be passed from frontend
        };

        console.log('Sending request to paymenku:', payload);

        // Call Paymenku API
        const response = await fetch('https://paymenku.com/api/v1/transaction/create', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${paymenkuApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const paymenkuData = await response.json();
        console.log('Paymenku response:', paymenkuData);

        if (paymenkuData.status !== 'success') {
            throw new Error(`Payment gateway error: ${JSON.stringify(paymenkuData)}`);
        }

        // Update database with payment_trx_id
        const trxId = paymenkuData.data.trx_id;
        const { error: updateError } = await supabase
            .from('queues')
            .update({ 
                payment_method: 'online',
                payment_trx_id: trxId,
                payment_channel: channel_code
            })
            .eq('nomor_antrian', nomor_antrian);

        if (updateError) {
            console.error('Error updating queue:', updateError);
            // We don't fail the payment if DB update fails, but we log it
        }

        return new Response(JSON.stringify(paymenkuData), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });

    } catch (error) {
        console.error('Error creating payment:', error);
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
        });
    }
});
