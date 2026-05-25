import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";

serve(async (req) => {
    // Only allow POST
    if (req.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    try {
        const signature = req.headers.get('X-PaymenKu-Signature');
        const timestamp = req.headers.get('X-PaymenKu-Timestamp');

        if (!signature || !timestamp) {
            return new Response('Missing signature or timestamp headers', { status: 400 });
        }

        const rawBody = await req.text();

        // Verify Signature
        const webhookSecret = Deno.env.get('PAYMENKU_WEBHOOK_SECRET');
        if (!webhookSecret) {
            console.error('PAYMENKU_WEBHOOK_SECRET is not set');
            return new Response('Internal Server Error', { status: 500 });
        }

        const signaturePayload = `${timestamp}.${rawBody}`;
        
        // HMAC SHA256 in Deno
        const key = await crypto.subtle.importKey(
            "raw",
            new TextEncoder().encode(webhookSecret),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign", "verify"]
        );
        const expectedSignatureBuffer = await crypto.subtle.sign(
            "HMAC",
            key,
            new TextEncoder().encode(signaturePayload)
        );
        
        // Convert to hex string
        const expectedSignatureArray = Array.from(new Uint8Array(expectedSignatureBuffer));
        const expectedSignature = expectedSignatureArray.map(b => b.toString(16).padStart(2, '0')).join('');

        if (signature !== expectedSignature) {
            console.error('Signature mismatch', { expected: expectedSignature, received: signature });
            return new Response('Invalid signature', { status: 401 });
        }

        // Parse Payload
        const payload = JSON.parse(rawBody);
        console.log('Webhook payload received:', payload);

        if (payload.event === 'payment.status_updated' && payload.status === 'paid') {
            const trxId = payload.trx_id;
            const referenceId = payload.reference_id; // ini nomor antrian kita

            // Setup Supabase Client
            const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
            const supabaseServiceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
            const supabase = createClient(supabaseUrl, supabaseServiceRole);

            // Ambil notes lama untuk preserve manual notes & clear payment note (Kurang bayar)
            const { data: existing } = await supabase
                .from('queues')
                .select('notes')
                .eq('nomor_antrian', referenceId)
                .limit(1)
                .single();

            let cleanedNotes = '';
            if (existing && existing.notes) {
                const PAYMENT_NOTE_DELIM = '\n---PAYMENT---\n';
                const idx = existing.notes.indexOf(PAYMENT_NOTE_DELIM);
                if (idx !== -1) {
                    // Hanya simpan bagian manual notes
                    cleanedNotes = existing.notes.substring(0, idx);
                } else if (existing.notes.startsWith('Kurang bayar:') || existing.notes.startsWith('Kelebihan bayar:')) {
                    // Format lama (flat) — auto payment note → bersihkan total
                    cleanedNotes = '';
                } else {
                    // Tidak ada delimiter & bukan auto → manual notes saja
                    cleanedNotes = existing.notes;
                }
            }

            // Update database: lunas + clear payment notes (preserve manual notes)
            const { data, error } = await supabase
                .from('queues')
                .update({ 
                    payment_status: 'lunas',
                    paid_at: new Date().toISOString(),
                    notes: cleanedNotes
                })
                .eq('nomor_antrian', referenceId);

            if (error) {
                console.error('Failed to update payment status in DB:', error);
                throw error;
            }
            console.log(`Payment confirmed for queue ${referenceId}`);
        }

        return new Response(JSON.stringify({ status: 'ok' }), {
            headers: { 'Content-Type': 'application/json' },
            status: 200,
        });

    } catch (error) {
        console.error('Webhook processing error:', error);
        return new Response(JSON.stringify({ error: error.message }), {
            headers: { 'Content-Type': 'application/json' },
            status: 500,
        });
    }
});
