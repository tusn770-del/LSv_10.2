import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "npm:stripe@18.4.0";
import { createClient } from "npm:@supabase/supabase-js@2.53.0";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
});

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      Deno.env.get("STRIPE_WEBHOOK_SECRET")!
    );
  } catch (err) {
    console.error("Webhook signature verification failed.", err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  try {
    switch (event.type) {
      /** Checkout completed: create subscription */
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        if (session.subscription && session.metadata?.user_id) {
          const subscription = await stripe.subscriptions.retrieve(
            session.subscription as string
          );

          const { error } = await supabase.rpc("handle_subscription_webhook", {
            p_user_id: session.metadata.user_id,
            p_plan_type: (session.metadata.plan_type || "monthly") as
              | "monthly"
              | "semiannual"
              | "annual",
            p_status: "active",
            p_stripe_subscription_id: subscription.id,
            p_stripe_customer_id: subscription.customer as string,
            p_period_start: new Date(
              subscription.current_period_start * 1000
            ).toISOString(),
            p_period_end: new Date(
              subscription.current_period_end * 1000
            ).toISOString(),
          });

          if (error) console.error("❌ Error creating subscription:", error);
          else console.log("✅ Subscription created via checkout");
        }
        break;
      }

      /** Invoice succeeded: keep subscription dates in sync */
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        if (!invoice.subscription) break;

        const subscription = await stripe.subscriptions.retrieve(
          invoice.subscription as string
        );

        // Use metadata if available, fallback to DB lookup
        let userId = invoice.metadata?.user_id || null;
        let planType = invoice.metadata?.plan_type || null;

        if (!userId || !planType) {
          const { data } = await supabase
            .from("subscriptions")
            .select("user_id, plan_type")
            .eq("stripe_customer_id", invoice.customer as string)
            .maybeSingle();

          if (data) {
            userId = data.user_id;
            planType = data.plan_type;
          }
        }

        if (userId && planType) {
          const { error } = await supabase.rpc("handle_subscription_webhook", {
            p_user_id: userId,
            p_plan_type: planType as "monthly" | "semiannual" | "annual",
            p_status: "active",
            p_stripe_subscription_id: subscription.id,
            p_stripe_customer_id: subscription.customer as string,
            p_period_start: new Date(
              subscription.current_period_start * 1000
            ).toISOString(),
            p_period_end: new Date(
              subscription.current_period_end * 1000
            ).toISOString(),
          });

          if (error)
            console.error("❌ Error updating subscription via invoice:", error);
          else console.log("✅ Subscription updated via invoice");
        }
        break;
      }

      /** Invoice failed: mark subscription as past_due */
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        if (!invoice.subscription) break;

        const subscription = await stripe.subscriptions.retrieve(
          invoice.subscription as string
        );

        const { error } = await supabase.rpc("handle_subscription_webhook", {
          p_user_id: invoice.metadata?.user_id,
          p_plan_type: invoice.metadata?.plan_type as
            | "monthly"
            | "semiannual"
            | "annual",
          p_status: "past_due",
          p_stripe_subscription_id: subscription.id,
          p_stripe_customer_id: subscription.customer as string,
          p_period_start: new Date(
            subscription.current_period_start * 1000
          ).toISOString(),
          p_period_end: new Date(
            subscription.current_period_end * 1000
          ).toISOString(),
        });

        if (error)
          console.error("❌ Error marking subscription past_due:", error);
        else console.log("⚠️ Subscription marked past_due");
        break;
      }

      /** Subscription canceled */
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;

        const { error } = await supabase.rpc("handle_subscription_webhook", {
          p_user_id: subscription.metadata?.user_id,
          p_plan_type: subscription.metadata?.plan_type as
            | "monthly"
            | "semiannual"
            | "annual",
          p_status: "canceled",
          p_stripe_subscription_id: subscription.id,
          p_stripe_customer_id: subscription.customer as string,
          p_period_start: new Date(
            subscription.current_period_start * 1000
          ).toISOString(),
          p_period_end: new Date(
            subscription.current_period_end * 1000
          ).toISOString(),
        });

        if (error)
          console.error("❌ Error canceling subscription:", error);
        else console.log("🛑 Subscription canceled");
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    console.error("❌ Webhook error:", err);
    return new Response("Webhook handler error", { status: 500 });
  }
});
