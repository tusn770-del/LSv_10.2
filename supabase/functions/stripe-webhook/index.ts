import Stripe from "npm:stripe@18.4.0";
import { createClient } from "npm:@supabase/supabase-js@2.53.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, stripe-signature",
};

// Helper to calculate period_end based on plan type
function calculatePeriodEnd(start: string, planType: 'monthly' | 'semiannual' | 'annual') {
  const date = new Date(start);
  switch (planType) {
    case 'monthly':
      date.setMonth(date.getMonth() + 1);
      break;
    case 'semiannual':
      date.setMonth(date.getMonth() + 6);
      break;
    case 'annual':
      date.setFullYear(date.getFullYear() + 1);
      break;
  }
  return date.toISOString();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
      apiVersion: '2023-10-16',
    });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const signature = req.headers.get('stripe-signature');
    const body = await req.text();

    if (!signature) return new Response('No signature', { status: 400 });

    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
    if (!webhookSecret) return new Response('Webhook secret not configured', { status: 500 });

    const event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
    console.log(`Processing webhook event: ${event.type} at ${new Date().toISOString()}`);

    async function updateSubscription(
      userId: string,
      planType: 'monthly' | 'semiannual' | 'annual',
      status: 'active' | 'past_due' | 'cancelled',
      stripeSubscriptionId: string | null,
      stripeCustomerId: string,
      periodStart: string,
      periodEnd: string
    ) {
      const { error } = await supabase.rpc('handle_subscription_webhook', {
        p_user_id: userId,
        p_plan_type: planType,
        p_status: status,
        p_stripe_subscription_id: stripeSubscriptionId,
        p_stripe_customer_id: stripeCustomerId,
        p_period_start: periodStart,
        p_period_end: periodEnd
      });

      console.log('Supabase RPC response:', { error });
      if (error) throw new Error('Subscription update failed');
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.user_id;
        const planType = session.metadata?.plan_type as 'monthly' | 'semiannual' | 'annual';
        if (userId && planType) {
          const periodStart = new Date().toISOString();
          const periodEnd = calculatePeriodEnd(periodStart, planType);
          await updateSubscription(userId, planType, 'active', session.subscription as string || null, session.customer as string, periodStart, periodEnd);
        } else console.warn('Missing metadata in checkout session:', session.metadata);
        break;
      }

      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object as Stripe.PaymentIntent;
        const userId = paymentIntent.metadata?.user_id;
        const planType = paymentIntent.metadata?.plan_type as 'monthly' | 'semiannual' | 'annual';
        if (userId && planType) {
          const periodStart = new Date().toISOString();
          const periodEnd = calculatePeriodEnd(periodStart, planType);
          await updateSubscription(userId, planType, 'active', null, paymentIntent.customer as string, periodStart, periodEnd);
        } else console.warn('Missing metadata in payment intent:', paymentIntent.metadata);
        break;
      }

      case 'invoice.payment_succeeded':
      case 'invoice.payment_failed':
      case 'customer.subscription.deleted': {
        const invoiceOrSub = event.data.object as any;
        let subscription: Stripe.Subscription | null = null;

        if (event.type.startsWith('invoice') && invoiceOrSub.subscription) {
          subscription = await stripe.subscriptions.retrieve(invoiceOrSub.subscription as string);
        } else if (event.type === 'customer.subscription.deleted') {
          subscription = invoiceOrSub as Stripe.Subscription;
        }

        if (subscription?.metadata?.user_id) {
          const userId = subscription.metadata.user_id;
          const planType = (subscription.metadata.plan_type || 'monthly') as 'monthly' | 'semiannual' | 'annual';
          const periodStart = new Date(subscription.current_period_start * 1000).toISOString();
          const periodEnd = new Date(subscription.current_period_end * 1000).toISOString();
          const status = event.type === 'invoice.payment_failed' ? 'past_due' :
                         event.type === 'customer.subscription.deleted' ? 'cancelled' : 'active';

          await updateSubscription(userId, planType, status, subscription.id, subscription.customer as string, periodStart, periodEnd);
        }
        break;
      }

      default:
        console.log(`Unhandled webhook event type: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true, event_type: event.type }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('Webhook processing error:', error);
    return new Response(JSON.stringify({ error: (error as any)?.message || 'unknown error' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
