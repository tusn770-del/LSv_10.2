/*
  Fix Subscription Billing Period Calculations
  - Correct monthly, semiannual, and annual period calculations
  - Update getter to return proper billing period ranges
  - Patch existing active subscriptions
*/

-- 1. Fix subscription period calculation function
CREATE OR REPLACE FUNCTION calculate_subscription_period_end(
  plan_type subscription_plan_type,
  period_start timestamptz DEFAULT now() 
)
RETURNS timestamptz
LANGUAGE plpgsql
AS $$
DECLARE
  end_date timestamptz;
BEGIN
  CASE plan_type
    WHEN 'trial' THEN
      end_date := period_start + interval '30 days';
    WHEN 'monthly' THEN
      end_date := period_start + interval '1 month';
    WHEN 'semiannual' THEN
      end_date := period_start + interval '6 months';
    WHEN 'annual' THEN
      end_date := period_start + interval '1 year';
    ELSE
      end_date := period_start + interval '1 month';
  END CASE;
  
  RETURN end_date;
END;
$$;

-- 2. Getter: subscription with proper period text
CREATE OR REPLACE FUNCTION get_subscription_with_periods(p_user_id uuid)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  plan_type subscription_plan_type,
  status subscription_status,
  stripe_subscription_id text,
  stripe_customer_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  days_remaining integer,
  is_expired boolean,
  is_cancelled boolean,
  billing_period_text text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.id,
    s.user_id,
    s.plan_type,
    s.status,
    s.stripe_subscription_id,
    s.stripe_customer_id,
    s.current_period_start,
    s.current_period_end,
    s.created_at,
    s.updated_at,
    GREATEST(0, EXTRACT(days FROM (s.current_period_end - now()))::integer) as days_remaining,
    (s.current_period_end <= now()) as is_expired,
    (s.status = 'cancelled') as is_cancelled,
    -- Build display string: "MM/DD/YYYY – MM/DD/YYYY (1 year)"
    TO_CHAR(s.current_period_start, 'MM/DD/YYYY') || ' – ' ||
    TO_CHAR(s.current_period_end, 'MM/DD/YYYY') || ' (' ||
    CASE s.plan_type
      WHEN 'annual' THEN '1 year'
      WHEN 'semiannual' THEN '6 months'
      WHEN 'monthly' THEN '1 month'
      WHEN 'trial' THEN 'trial period'
      ELSE 'unknown'
    END || ')' as billing_period_text
  FROM subscriptions s
  WHERE s.user_id = p_user_id
  ORDER BY s.created_at DESC
  LIMIT 1;
END;
$$;

-- 3. One-time patch existing subscriptions (optional, run once)
UPDATE subscriptions
SET current_period_end = calculate_subscription_period_end(plan_type, current_period_start)
WHERE status = 'active';
