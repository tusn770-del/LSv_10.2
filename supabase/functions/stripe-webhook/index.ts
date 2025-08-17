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
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const sig = req.headers.get("stripe-signature");
    if (!sig) throw new Error("Missing Stripe signature");

    const body = await req.text();
    const event = stripe.webhooks.constructEvent(
      body,
      sig,
      Deno.env.get("STRIPE_WEBHOOK_SECRET")!
    );

    console.log("➡️ Stripe Event:", event.type);

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log("💳 Checkout completed:", {
          sessionId: session.id,
          userId: session.metadata?.user_id,
          planType: session.metadata?.plan_type,
          customerId: session.customer,
          subscriptionId: session.subscription,
        });

        if (session.metadata?.user_id && session.metadata?.plan_type) {
          const userId = session.metadata.user_id;
          const planType = session.metadata
            .plan_type as "monthly" | "semiannual" | "annual";

          if (session.subscription) {
            const stripeSub = await stripe.subscriptions.retrieve(
              session.subscription as string
            );

            const { error } = await supabase.rpc("handle_subscription_webhook", {
              p_user_id: userId,
              p_plan_type: planType,
              p_status: "active",
              p_stripe_subscription_id: stripeSub.id,
              p_stripe_customer_id: stripeSub.customer as string,
              p_period_start: new Date(
                stripeSub.current_period_start * 1000
              ).toISOString(),
              p_period_end: new Date(
                stripeSub.current_period_end * 1000
              ).toISOString(),
            });

            if (error) {
              console.error(
                "❌ Error updating subscription via checkout:",
                error
              );
              throw error;
            } else {
              console.log(
                "✅ Subscription updated successfully via checkout for user:",
                userId
              );
            }
          }
        } else {
          console.warn("⚠️ Missing metadata in checkout session:", session.metadata);
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        console.log("💰 Invoice payment succeeded:", {
          invoiceId: invoice.id,
          customerId: invoice.customer,
          subscriptionId: invoice.subscription,
        });

        if (invoice.subscription && invoice.customer) {
          const stripeSub = await stripe.subscriptions.retrieve(
            invoice.subscription as string
          );

          const { error } = await supabase.rpc("handle_subscription_webhook", {
            p_user_id: invoice.metadata?.user_id || null,
            p_plan_type: invoice.metadata?.plan_type || null,
            p_status: "active",
            p_stripe_subscription_id: stripeSub.id,
            p_stripe_customer_id: stripeSub.customer as string,
            p_period_start: new Date(
              stripeSub.current_period_start * 1000
            ).toISOString(),
            p_period_end: new Date(
              stripeSub.current_period_end * 1000
            ).toISOString(),
          });

          if (error) {
            console.error("❌ Error updating subscription via invoice:", error);
            throw error;
          } else {
            console.log(
              "✅ Subscription updated successfully via invoice:",
              stripeSub.id
            );
          }
        }
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.created": {
        const subscription = event.data.object as Stripe.Subscription;
        console.log("🔄 Subscription created/updated:", {
          subscriptionId: subscription.id,
          customerId: subscription.customer,
          status: subscription.status,
        });

        const { error } = await supabase.rpc("handle_subscription_webhook", {
          p_user_id: subscription.metadata?.user_id || null,
          p_plan_type: subscription.metadata
            ?.plan_type as "monthly" | "semiannual" | "annual",
          p_status: subscription.status,
          p_stripe_subscription_id: subscription.id,
          p_stripe_customer_id: subscription.customer as string,
          p_period_start: new Date(
            subscription.current_period_start * 1000
          ).toISOString(),
          p_period_end: new Date(
            subscription.current_period_end * 1000
          ).toISOString(),
        });

        if (error) {
          console.error("❌ Error updating subscription via subscription.updated:", error);
          throw error;
        } else {
          console.log(
            "✅ Subscription updated successfully via subscription.updated:",
            subscription.id
          );
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        console.log("🛑 Subscription cancelled:", {
          subscriptionId: subscription.id,
          customerId: subscription.customer,
          status: subscription.status,
        });

        const { error } = await supabase.rpc("handle_subscription_webhook", {
          p_user_id: subscription.metadata?.user_id || null,
          p_plan_type: subscription.metadata
            ?.plan_type as "monthly" | "semiannual" | "annual",
          p_status: "cancelled",
          p_stripe_subscription_id: subscription.id,
          p_stripe_customer_id: subscription.customer as string,
          p_period_start: new Date(
            subscription.current_period_start * 1000
          ).toISOString(),
          p_period_end: new Date(
            subscription.current_period_end * 1000
          ).toISOString(),
        });

        if (error) {
          console.error("❌ Error cancelling subscription:", error);
          throw error;
        } else {
          console.log(
            "✅ Subscription cancelled successfully:",
            subscription.id
          );
        }
        break;
      }

      default:
        console.log(`ℹ️ Unhandled event type: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (err) {
    console.error("❌ Webhook error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});
 