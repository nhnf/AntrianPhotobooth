import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

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
        const { searchParams } = new URL(req.url);
        const orderId = searchParams.get('order_id');

        if (!orderId) {
            return new Response(JSON.stringify({ error: 'order_id is required' }), {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 400,
            });
        }

        // Fetch Paymenku API Key
        const paymenkuApiKey = Deno.env.get('PAYMENKU_API_KEY');
        if (!paymenkuApiKey) {
            throw new Error('PAYMENKU_API_KEY is not set');
        }

        console.log(`Checking payment status for order: ${orderId}`);

        // Call Paymenku API
        const response = await fetch(`https://paymenku.com/api/v1/check-status/${orderId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${paymenkuApiKey}`,
            }
        });

        const paymenkuData = await response.json();
        console.log('Paymenku response:', paymenkuData);

        return new Response(JSON.stringify(paymenkuData), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200,
        });

    } catch (error) {
        console.error('Error checking payment:', error);
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 500,
        });
    }
});
