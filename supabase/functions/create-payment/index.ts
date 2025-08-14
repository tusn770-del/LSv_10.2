import Stripe from "npm:stripe@18.4.0";
import { createClient } from "npm:@supabase/supabase-js@2.53.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface PaymentRequest {
  planType: 'monthly' | 'semiannual' | 'annual';
  autoRenew: boolean;
  paymentMethodId: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    // Get the user
    const {
      data: { user },
    } = await supabaseClient.auth.getUser();

    if (!user) {
      throw new Error('Unauthorized');
    }

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
      apiVersion: '2023-10-16',
    });

    const { planType, autoRenew, paymentMethodId }: PaymentRequest = await req.json();

    // Define price mapping
    const priceMap = {
      monthly: Deno.env.get('STRIPE_MONTHLY_PRICE_ID'),
      semiannual: Deno.env.get('STRIPE_SEMIANNUAL_PRICE_ID'), 
      annual: Deno.env.get('STRIPE_ANNUAL_PRICE_ID')
    };

    const amounts = {
      monthly: 299, // $2.99 in cents
      semiannual: 999, // $9.99 in cents
      annual: 1999 // $19.99 in cents
    };

    // Validate that we have a valid price ID
    const priceId = priceMap[planType];
    if (!priceId) {
      throw new Error(`Price ID not configured for plan: ${planType}`);
    }

    // Get or create Stripe customer
    let stripeCustomerId: string;

    const { data: existingSubscription } = await supabaseClient
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .single();

    if (existingSubscription?.stripe_customer_id) {
      stripeCustomerId = existingSubscription.stripe_customer_id;
    } else {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          supabase_user_id: user.id,
        },
      });
      stripeCustomerId = customer.id;
    }

    if (autoRenew) {
      // Create subscription
      const subscription = await stripe.subscriptions.create({
        customer: stripeCustomerId,
        items: [{ price: priceId }],
        payment_behavior: 'default_incomplete',
        payment_settings: { save_default_payment_method: 'on_subscription' },
        expand: ['latest_invoice.payment_intent'],
        metadata: {
          user_id: user.id,
          plan_type: planType,
        },
      });

      const invoice = subscription.latest_invoice as Stripe.Invoice;
      const paymentIntent = invoice.payment_intent as Stripe.PaymentIntent;

      return new Response(
        JSON.stringify({ 
          clientSecret: paymentIntent.client_secret,
          subscriptionId: subscription.id 
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    } else {
      // Create one-time payment
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amounts[planType],
        currency: 'usd',
        customer: stripeCustomerId,
        payment_method: paymentMethodId,
        confirmation_method: 'manual',
        confirm: true,
        return_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/payment-return`,
        metadata: {
          user_id: user.id,
          plan_type: planType,
        },
      });

      return new Response(
        JSON.stringify({ 
          clientSecret: paymentIntent.client_secret,
          status: paymentIntent.status 
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }
  } catch (error) {
    console.error('Error creating payment:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});