import { supabase } from '../lib/supabase';

export interface Subscription {
  id: string;
  user_id: string;
  plan_type: 'trial' | 'monthly' | 'semiannual' | 'annual';
  status: 'active' | 'expired' | 'cancelled' | 'past_due';
  stripe_subscription_id?: string;
  stripe_customer_id?: string;
  current_period_start: string;
  current_period_end: string;
  created_at: string;
  updated_at: string;
}

export interface PlanFeatures {
  maxCustomers: number;
  maxBranches: number;
  advancedAnalytics: boolean;
  prioritySupport: boolean;
  customBranding: boolean;
  apiAccess: boolean;
}

export class SubscriptionService {
  static async createSubscription(
    userId: string,
    planType: 'trial' | 'monthly' | 'semiannual' | 'annual',
    stripeSubscriptionId?: string,
    stripeCustomerId?: string
  ): Promise<Subscription> {
    try {
      // First check if user already has a subscription
      const existingSubscription = await this.getUserSubscription(userId);
      
      if (existingSubscription && existingSubscription.status === 'active') {
        // If user has active subscription, update it instead of creating new one
        return await this.updateSubscription(existingSubscription.id, planType, stripeSubscriptionId, stripeCustomerId);
      }

      // Calculate period dates based on plan type
      const now = new Date();
      const periodStart = now.toISOString();
      let periodEnd: Date;

      switch (planType) {
        case 'trial':
          periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
          break;
        case 'monthly':
          periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
          break;
        case 'semiannual':
          periodEnd = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000); // 6 months
          break;
        case 'annual':
          periodEnd = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year
          break;
        default:
          periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      }

      // If existing subscription found, update it instead
      if (existingSubscription) {
        const { data, error } = await supabase
          .from('subscriptions')
          .update({
            plan_type: planType,
            status: 'active',
            stripe_subscription_id: stripeSubscriptionId,
            stripe_customer_id: stripeCustomerId,
            current_period_start: periodStart,
            current_period_end: periodEnd.toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', existingSubscription.id)
          .select()
          .single();

        if (error) {
          console.error('Subscription update error:', error);
          throw new Error(`Failed to update subscription: ${error.message}`);
        }
        
        return data;
      }

      // Create new subscription
      const { data, error } = await supabase
        .from('subscriptions')
        .insert({
          user_id: userId,
          plan_type: planType,
          status: 'active',
          stripe_subscription_id: stripeSubscriptionId,
          stripe_customer_id: stripeCustomerId,
          current_period_start: periodStart,
          current_period_end: periodEnd.toISOString()
        })
        .select()
        .single();

      if (error) {
        console.error('Subscription creation error:', error);
        throw new Error(`Failed to create subscription: ${error.message}`);
      }
      
      return data;
    } catch (error: any) {
      console.error('Error creating subscription:', error);
      throw error;
    }
  }

  static async updateSubscription(
    subscriptionId: string,
    planType: 'trial' | 'monthly' | 'semiannual' | 'annual',
    stripeSubscriptionId?: string,
    stripeCustomerId?: string
  ): Promise<Subscription> {
    try {
      const now = new Date();
      let periodEnd: Date;

      switch (planType) {
        case 'trial':
          periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
          break;
        case 'monthly':
          periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
          break;
        case 'semiannual':
          periodEnd = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000);
          break;
        case 'annual':
          periodEnd = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
          break;
        default:
          periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      }

      const { data, error } = await supabase
        .from('subscriptions')
        .update({
          plan_type: planType,
          status: 'active',
          stripe_subscription_id: stripeSubscriptionId,
          stripe_customer_id: stripeCustomerId,
          current_period_end: periodEnd.toISOString(),
          updated_at: now.toISOString()
        })
        .eq('id', subscriptionId)
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error: any) {
      console.error('Error updating subscription:', error);
      throw error;
    }
  }

  static async getUserSubscription(userId: string): Promise<Subscription | null> {
    try {
      const { data, error } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching subscription:', error);
        return null;
      }
      
      return data;
    } catch (error: any) {
      console.error('Error fetching user subscription:', error);
      return null;
    }
  }

  static async updateSubscriptionStatus(
    subscriptionId: string,
    status: 'active' | 'expired' | 'cancelled' | 'past_due'
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('subscriptions')
        .update({ 
          status,
          updated_at: new Date().toISOString()
        })
        .eq('id', subscriptionId);

      if (error) throw error;
    } catch (error: any) {
      console.error('Error updating subscription status:', error);
      throw error;
    }
  }

  static async checkSubscriptionAccess(userId: string): Promise<{
    hasAccess: boolean;
    subscription: Subscription | null;
    features: PlanFeatures;
    daysRemaining?: number;
  }> {
    try {
      // Direct subscription check without RPC function
      const subscription = await this.getUserSubscription(userId);
      return this.fallbackAccessCheck(subscription);
    } catch (error: any) {
      console.error('Error checking subscription access:', error);
      // Fallback to basic access
      return {
        hasAccess: true, // Allow access during errors to prevent lockout
        subscription: null,
        features: this.getTrialFeatures(),
        daysRemaining: 30
      };
    }
  }

  private static fallbackAccessCheck(subscription: Subscription | null): {
    hasAccess: boolean;
    subscription: Subscription | null;
    features: PlanFeatures;
    daysRemaining?: number;
  } {
    if (!subscription) {
      return {
        hasAccess: true, // Allow access for new users
        subscription: null,
        features: this.getTrialFeatures(),
        daysRemaining: 30
      };
    }

    const now = new Date();
    const endDate = new Date(subscription.current_period_end);
    const hasAccess = subscription.status === 'active' && endDate > now;
    const daysRemaining = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    return {
      hasAccess,
      subscription,
      features: this.getPlanFeatures(subscription.plan_type),
      daysRemaining: Math.max(0, daysRemaining)
    };
  }

  static getPlanFeatures(planType: 'trial' | 'monthly' | 'semiannual' | 'annual'): PlanFeatures {
    switch (planType) {
      case 'trial':
        return this.getTrialFeatures();
      case 'monthly':
      case 'semiannual':
      case 'annual':
        return {
          maxCustomers: -1, // Unlimited
          maxBranches: -1, // Unlimited
          advancedAnalytics: true,
          prioritySupport: true,
          customBranding: planType !== 'monthly',
          apiAccess: planType !== 'monthly'
        };
      default:
        return this.getTrialFeatures();
    }
  }

  private static getTrialFeatures(): PlanFeatures {
    return {
      maxCustomers: 100,
      maxBranches: 1,
      advancedAnalytics: false,
      prioritySupport: false,
      customBranding: false,
      apiAccess: false
    };
  }

  static async getSystemWideStats(): Promise<{
    totalRevenue: number;
    totalCustomers: number;
    totalRestaurants: number;
    totalTransactions: number;
    monthlyGrowth: number;
  }> {
    try {
      // Get all restaurants
      const { data: restaurants, error: restaurantsError } = await supabase
        .from('restaurants')
        .select('id');

      if (restaurantsError) throw restaurantsError;

      const restaurantIds = restaurants?.map(r => r.id) || [];

      // Get system-wide customer data
      const { data: customers, error: customersError } = await supabase
        .from('customers')
        .select('total_spent, created_at')
        .in('restaurant_id', restaurantIds);

      if (customersError) throw customersError;

      // Get system-wide transaction data
      const { data: transactions, error: transactionsError } = await supabase
        .from('transactions')
        .select('amount_spent, created_at')
        .in('restaurant_id', restaurantIds);

      if (transactionsError) throw transactionsError;

      // Calculate metrics
      const totalRevenue = customers?.reduce((sum, c) => sum + parseFloat(c.total_spent?.toString() || '0'), 0) || 0;
      const totalCustomers = customers?.length || 0;
      const totalRestaurants = restaurants?.length || 0;
      const totalTransactions = transactions?.length || 0;

      // Calculate monthly growth
      const lastMonth = new Date();
      lastMonth.setMonth(lastMonth.getMonth() - 1);
      
      const newCustomersThisMonth = customers?.filter(c => 
        new Date(c.created_at) > lastMonth
      ).length || 0;
      
      const monthlyGrowth = totalCustomers > 0 ? (newCustomersThisMonth / totalCustomers) * 100 : 0;

      return {
        totalRevenue,
        totalCustomers,
        totalRestaurants,
        totalTransactions,
        monthlyGrowth
      };
    } catch (error: any) {
      console.error('Error fetching system-wide stats:', error);
      return {
        totalRevenue: 0,
        totalCustomers: 0,
        totalRestaurants: 0,
        totalTransactions: 0,
        monthlyGrowth: 0
      };
    }
  }

  static async getAllSubscriptions(): Promise<(Subscription & { 
    user_email?: string;
    restaurant_name?: string;
  })[]> {
    try {
      // Use the database function to get recent subscriptions with proper joins
      const { data, error } = await supabase.rpc('get_recent_subscriptions', { limit_count: 100 });
      
      if (error) {
        console.error('Error fetching subscriptions via RPC:', error);
        // Fallback to basic query without joins
        const { data: basicSubs, error: basicError } = await supabase
          .from('subscriptions')
          .select('*')
          .order('created_at', { ascending: false });
          
        if (basicError) throw basicError;
        
        return (basicSubs || []).map(sub => ({
          ...sub,
          user_email: 'Unknown',
          restaurant_name: 'Unknown Restaurant'
        }));
      }
      
      return data || [];
    } catch (error: any) {
      console.error('Error fetching all subscriptions:', error);
      return [];
    }
  }

  static async getSubscriptionStats(): Promise<{
    total: number;
    active: number;
    trial: number;
    paid: number;
    revenue: number;
    churnRate: number;
  }> {
    try {
      // Use the updated database function for accurate statistics
      const { data, error } = await supabase.rpc('get_subscription_statistics');
      
      if (error) {
        console.error('Error fetching subscription stats via RPC:', error);
        // Fallback to basic calculation
        const { data: subscriptions, error: basicError } = await supabase
          .from('subscriptions')
          .select('plan_type, status');

        if (basicError) throw basicError;

        const total = subscriptions?.length || 0;
        const active = subscriptions?.filter(s => s.status === 'active').length || 0;
        const trial = subscriptions?.filter(s => s.plan_type === 'trial').length || 0;
        const paid = subscriptions?.filter(s => s.plan_type !== 'trial' && s.status === 'active').length || 0;
        const cancelled = subscriptions?.filter(s => s.status === 'cancelled').length || 0;
        
        // Calculate TOTAL revenue generated (not monthly recurring)
        const totalRevenue = subscriptions?.reduce((sum, sub) => {
          if (sub.status === 'active' || sub.status === 'expired') {
            if (sub.plan_type === 'monthly') return sum + 2.99;
            if (sub.plan_type === 'semiannual') return sum + 9.99;
            if (sub.plan_type === 'annual') return sum + 19.99;
          }
          return sum;
        }, 0) || 0;
        
        const churnRate = total > 0 ? (cancelled / total) * 100 : 0;

        return { total, active, trial, paid, revenue: totalRevenue, churnRate };
      }
      
      return {
        total: data.total || 0,
        active: data.active || 0,
        trial: data.trial || 0,
        paid: data.paid || 0,
        revenue: data.totalRevenue || 0, // Now using total revenue instead of monthly
        churnRate: data.churnRate || 0
      };
    } catch (error: any) {
      console.error('Error fetching subscription stats:', error);
      return {
        total: 0,
        active: 0,
        trial: 0,
        paid: 0,
        revenue: 0,
        churnRate: 0
      };
    }
  }

  static async getSystemWideStats(): Promise<{
    totalRevenue: number;
    totalCustomers: number;
    totalRestaurants: number;
    totalTransactions: number;
    monthlyGrowth: number;
  }> {
    try {
      // Use the database function for comprehensive system stats
      const { data, error } = await supabase.rpc('get_system_wide_stats');
      
      if (error) {
        console.error('Error fetching system stats via RPC:', error);
        // Fallback to basic queries
        const [restaurantCount, customerCount, transactionCount] = await Promise.all([
          supabase.from('restaurants').select('*', { count: 'exact', head: true }),
          supabase.from('customers').select('*', { count: 'exact', head: true }),
          supabase.from('transactions').select('*', { count: 'exact', head: true })
        ]);
        
        return {
          totalRevenue: 0,
          totalCustomers: customerCount.count || 0,
          totalRestaurants: restaurantCount.count || 0,
          totalTransactions: transactionCount.count || 0,
          monthlyGrowth: 0
        };
      }
      
      return {
        totalRevenue: data.totalRevenue || 0,
        totalCustomers: data.totalCustomers || 0,
        totalRestaurants: data.totalRestaurants || 0,
        totalTransactions: data.totalTransactions || 0,
        monthlyGrowth: 0 // Can be calculated from the data if needed
      };
    } catch (error: any) {
      console.error('Error fetching system-wide stats:', error);
      return {
        totalRevenue: 0,
        totalCustomers: 0,
        totalRestaurants: 0,
        totalTransactions: 0,
        monthlyGrowth: 0
      };
    }
  }
}