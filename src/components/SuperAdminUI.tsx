import React, { useState, useEffect, useRef } from 'react';
import { 
  Users, Building, DollarSign, TrendingUp, BarChart3, 
  Search, Filter, Eye, MoreVertical, RefreshCw, AlertCircle,
  MessageSquare, Clock, CheckCircle, Crown, Award, Star,
  ChefHat, Mail, Phone, Calendar, MapPin, Settings,
  ArrowRight, ArrowLeft, X, Send, Loader2, Plus,
  FileText, Shield, Target, Zap, Gift, Bell
} from 'lucide-react';
import { SubscriptionService } from '../services/subscriptionService';
import { SupportService, SupportTicket, SupportMessage } from '../services/supportService';

const SuperAdminUI: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'overview' | 'restaurants' | 'subscriptions' | 'support'>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Overview data
  const [systemStats, setSystemStats] = useState<any>(null);
  const [subscriptionStats, setSubscriptionStats] = useState<any>(null);
  
  // Restaurants data
  const [restaurants, setRestaurants] = useState<any[]>([]);
  const [restaurantSearch, setRestaurantSearch] = useState('');
  
  // Subscriptions data
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [subscriptionSearch, setSubscriptionSearch] = useState('');
  
  // Support data
  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [ticketSearch, setTicketSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const subscriptionRef = useRef<any>(null);

  // Auto-scroll to bottom when new messages arrive
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Check authentication
  useEffect(() => {
    const isAuthenticated = localStorage.getItem('super_admin_authenticated');
    const loginTime = localStorage.getItem('super_admin_login_time');
    
    if (!isAuthenticated || !loginTime) {
      window.location.href = '/super-admin-login';
      return;
    }
    
    // Check if session is still valid (24 hours)
    const loginDate = new Date(loginTime);
    const now = new Date();
    const hoursDiff = (now.getTime() - loginDate.getTime()) / (1000 * 60 * 60);
    
    if (hoursDiff > 24) {
      localStorage.removeItem('super_admin_authenticated');
      localStorage.removeItem('super_admin_login_time');
      window.location.href = '/super-admin-login';
      return;
    }
    
    // Load initial data
    loadDashboardData();
  }, []);

  // Real-time subscription for support messages
  useEffect(() => {
    if (selectedTicket) {
      fetchMessages();
      setupMessageSubscription();
    }
    
    return () => {
      if (subscriptionRef.current) {
        console.log('🔌 Super Admin: Cleaning up message subscription');
        subscriptionRef.current.unsubscribe();
        subscriptionRef.current = null;
      }
    };
  }, [selectedTicket]);

  const setupMessageSubscription = () => {
    if (!selectedTicket) return;
    
    // Clean up existing subscription
    if (subscriptionRef.current) {
      subscriptionRef.current.unsubscribe();
    }
    
    console.log('🔌 Super Admin: Setting up message subscription for ticket:', selectedTicket.id);
    
    subscriptionRef.current = SupportService.subscribeToMessages(
      selectedTicket.id,
      (payload) => {
        console.log('📨 Super Admin: Real-time message update:', payload);
        
        if (payload.eventType === 'INSERT' && payload.new) {
          setMessages(prev => {
            // Check if message already exists
            const exists = prev.some(msg => msg.id === payload.new.id);
            if (exists) {
              console.log('📨 Super Admin: Message already exists, skipping');
              return prev;
            }
            
            console.log('📨 Super Admin: Adding new message:', payload.new);
            const newMessages = [...prev, payload.new].sort((a, b) => 
              new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
            return newMessages;
          });
        }
      }
    );
  };

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      setError('');

      const [systemData, subscriptionData, restaurantData, supportData] = await Promise.all([
        SubscriptionService.getSystemWideStats(),
        SubscriptionService.getSubscriptionStats(),
        loadRestaurants(),
        SupportService.getAllTickets()
      ]);

      setSystemStats(systemData);
      setSubscriptionStats(subscriptionData);
      setSupportTickets(supportData);
      
    } catch (err: any) {
      console.error('Error loading dashboard data:', err);
      setError('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  const loadRestaurants = async () => {
    try {
      // Get restaurants with owner information
      const { data, error } = await import('../lib/supabase').then(({ supabase }) => 
        supabase
          .from('restaurants')
          .select(`
            *,
            owner:users(email, user_metadata)
          `)
          .order('created_at', { ascending: false })
      );

      if (error) throw error;
      
      const restaurantsData = data || [];
      setRestaurants(restaurantsData);
      return restaurantsData;
    } catch (error) {
      console.error('Error loading restaurants:', error);
      return [];
    }
  };

  const loadSubscriptions = async () => {
    try {
      const subscriptionsData = await SubscriptionService.getAllSubscriptions();
      setSubscriptions(subscriptionsData);
    } catch (error) {
      console.error('Error loading subscriptions:', error);
    }
  };

  const fetchMessages = async () => {
    if (!selectedTicket) return;
    
    try {
      const messagesData = await SupportService.getTicketMessages(selectedTicket.id);
      setMessages(messagesData.sort((a, b) => 
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      ));
    } catch (error) {
      console.error('Error fetching messages:', error);
    }
  };

  const handleSendMessage = async () => {
    if (!selectedTicket || !newMessage.trim()) return;

    try {
      setSendingMessage(true);
      
      console.log('📤 Super Admin: Sending message:', {
        ticketId: selectedTicket.id,
        message: newMessage.trim()
      });
      
      // Optimistically add message to UI
      const optimisticMessage: SupportMessage = {
        id: `temp-${Date.now()}`,
        ticket_id: selectedTicket.id,
        sender_type: 'super_admin',
        sender_id: 'super_admin',
        message: newMessage.trim(),
        created_at: new Date().toISOString()
      };
      
      setMessages(prev => [...prev, optimisticMessage]);
      setNewMessage('');
      
      await SupportService.sendMessage({
        ticket_id: selectedTicket.id,
        sender_type: 'super_admin',
        sender_id: 'super_admin',
        message: newMessage.trim()
      });

      console.log('✅ Super Admin: Message sent successfully');
      
      // Remove optimistic message and let real-time subscription handle the real one
      setTimeout(() => {
        setMessages(prev => prev.filter(msg => !msg.id.startsWith('temp-')));
      }, 1000);
      
    } catch (error) {
      console.error('Error sending message:', error);
      // Remove optimistic message on error
      setMessages(prev => prev.filter(msg => !msg.id.startsWith('temp-')));
      setNewMessage(newMessage); // Restore message
      alert('Failed to send message');
    } finally {
      setSendingMessage(false);
    }
  };

  const handleUpdateTicketStatus = async (ticketId: string, status: string) => {
    try {
      await SupportService.updateTicketStatus(ticketId, status as any, 'super_admin');
      
      // Update local state
      setSupportTickets(prev => prev.map(ticket => 
        ticket.id === ticketId ? { ...ticket, status: status as any } : ticket
      ));
      
      if (selectedTicket?.id === ticketId) {
        setSelectedTicket(prev => prev ? { ...prev, status: status as any } : null);
      }
    } catch (error) {
      console.error('Error updating ticket status:', error);
      alert('Failed to update ticket status');
    }
  };

  const handleSignOut = () => {
    localStorage.removeItem('super_admin_authenticated');
    localStorage.removeItem('super_admin_login_time');
    window.location.href = '/super-admin-login';
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'open': return 'bg-blue-100 text-blue-800';
      case 'in_progress': return 'bg-yellow-100 text-yellow-800';
      case 'resolved': return 'bg-green-100 text-green-800';
      case 'closed': return 'bg-gray-100 text-gray-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'bg-red-100 text-red-800';
      case 'high': return 'bg-orange-100 text-orange-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const filteredTickets = supportTickets.filter(ticket => {
    const matchesSearch = ticket.title.toLowerCase().includes(ticketSearch.toLowerCase()) ||
                         ticket.description.toLowerCase().includes(ticketSearch.toLowerCase()) ||
                         ticket.restaurant?.name?.toLowerCase().includes(ticketSearch.toLowerCase());
    const matchesStatus = statusFilter === 'all' || ticket.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const filteredRestaurants = restaurants.filter(restaurant =>
    restaurant.name.toLowerCase().includes(restaurantSearch.toLowerCase()) ||
    restaurant.owner?.email?.toLowerCase().includes(restaurantSearch.toLowerCase())
  );

  const filteredSubscriptions = subscriptions.filter(subscription =>
    subscription.user_email?.toLowerCase().includes(subscriptionSearch.toLowerCase()) ||
    subscription.restaurant_name?.toLowerCase().includes(subscriptionSearch.toLowerCase())
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-red-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading Super Admin Dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-gradient-to-br from-red-500 to-red-700 rounded-xl flex items-center justify-center">
              <ChefHat className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Super Admin Dashboard</h1>
              <p className="text-sm text-gray-600">System-wide oversight and control</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={loadDashboardData}
              className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <RefreshCw className="h-5 w-5" />
            </button>
            <button
              onClick={handleSignOut}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="bg-white border-b border-gray-200">
        <div className="px-6">
          <nav className="flex space-x-8">
            {[
              { id: 'overview', label: 'Overview', icon: BarChart3 },
              { id: 'restaurants', label: 'Restaurants', icon: Building },
              { id: 'subscriptions', label: 'Subscriptions', icon: Crown },
              { id: 'support', label: 'Support', icon: MessageSquare }
            ].map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTab(tab.id as any);
                    if (tab.id === 'subscriptions' && subscriptions.length === 0) {
                      loadSubscriptions();
                    }
                  }}
                  className={`flex items-center gap-2 py-4 px-2 border-b-2 font-medium text-sm transition-colors ${
                    activeTab === tab.id
                      ? 'border-red-500 text-red-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      <div className="p-6">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl mb-6 flex items-center gap-3">
            <AlertCircle className="h-5 w-5" />
            {error}
          </div>
        )}

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-900">System Overview</h2>
            
            {/* System Stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="bg-white rounded-2xl p-6 border border-gray-200">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                    <Building className="h-6 w-6 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Total Restaurants</p>
                    <p className="text-2xl font-bold text-gray-900">{systemStats?.totalRestaurants || 0}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl p-6 border border-gray-200">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                    <Users className="h-6 w-6 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Total Customers</p>
                    <p className="text-2xl font-bold text-gray-900">{systemStats?.totalCustomers || 0}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl p-6 border border-gray-200">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
                    <DollarSign className="h-6 w-6 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Total Revenue</p>
                    <p className="text-2xl font-bold text-gray-900">{formatCurrency(systemStats?.totalRevenue || 0)}</p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl p-6 border border-gray-200">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 bg-yellow-100 rounded-xl flex items-center justify-center">
                    <TrendingUp className="h-6 w-6 text-yellow-600" />
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Total Transactions</p>
                    <p className="text-2xl font-bold text-gray-900">{systemStats?.totalTransactions || 0}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Subscription Stats */}
            {subscriptionStats && (
              <div className="bg-white rounded-2xl p-6 border border-gray-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-6">Subscription Overview</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
                  <div className="text-center">
                    <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center mx-auto mb-2">
                      <Users className="h-6 w-6 text-blue-600" />
                    </div>
                    <p className="text-sm text-gray-600">Total</p>
                    <p className="text-2xl font-bold text-gray-900">{subscriptionStats.total}</p>
                  </div>
                  
                  <div className="text-center">
                    <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center mx-auto mb-2">
                      <CheckCircle className="h-6 w-6 text-green-600" />
                    </div>
                    <p className="text-sm text-gray-600">Active</p>
                    <p className="text-2xl font-bold text-gray-900">{subscriptionStats.active}</p>
                  </div>
                  
                  <div className="text-center">
                    <div className="w-12 h-12 bg-yellow-100 rounded-xl flex items-center justify-center mx-auto mb-2">
                      <Clock className="h-6 w-6 text-yellow-600" />
                    </div>
                    <p className="text-sm text-gray-600">Trial</p>
                    <p className="text-2xl font-bold text-gray-900">{subscriptionStats.trial}</p>
                  </div>
                  
                  <div className="text-center">
                    <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center mx-auto mb-2">
                      <Crown className="h-6 w-6 text-purple-600" />
                    </div>
                    <p className="text-sm text-gray-600">Paid</p>
                    <p className="text-2xl font-bold text-gray-900">{subscriptionStats.paid}</p>
                  </div>
                  
                  <div className="text-center">
                    <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center mx-auto mb-2">
                      <DollarSign className="h-6 w-6 text-green-600" />
                    </div>
                    <p className="text-sm text-gray-600">Revenue</p>
                    <p className="text-2xl font-bold text-gray-900">{formatCurrency(subscriptionStats.revenue)}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Restaurants Tab */}
        {activeTab === 'restaurants' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900">Restaurant Management</h2>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search restaurants..."
                    value={restaurantSearch}
                    onChange={(e) => setRestaurantSearch(e.target.value)}
                    className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left py-3 px-6 font-medium text-gray-700">Restaurant</th>
                      <th className="text-left py-3 px-6 font-medium text-gray-700">Owner</th>
                      <th className="text-left py-3 px-6 font-medium text-gray-700">Created</th>
                      <th className="text-left py-3 px-6 font-medium text-gray-700">Slug</th>
                      <th className="text-right py-3 px-6 font-medium text-gray-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredRestaurants.map((restaurant) => (
                      <tr key={restaurant.id} className="hover:bg-gray-50">
                        <td className="py-4 px-6">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-blue-700 rounded-lg flex items-center justify-center text-white font-medium">
                              {restaurant.name.charAt(0)}
                            </div>
                            <div>
                              <p className="font-medium text-gray-900">{restaurant.name}</p>
                              <p className="text-sm text-gray-600">ID: {restaurant.id.slice(-8)}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-4 px-6">
                          <p className="text-gray-900">{restaurant.owner?.email || 'Unknown'}</p>
                        </td>
                        <td className="py-4 px-6 text-gray-600">
                          {formatDate(restaurant.created_at)}
                        </td>
                        <td className="py-4 px-6">
                          <code className="text-sm bg-gray-100 px-2 py-1 rounded">{restaurant.slug}</code>
                        </td>
                        <td className="py-4 px-6 text-right">
                          <button className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
                            <MoreVertical className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Subscriptions Tab */}
        {activeTab === 'subscriptions' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900">Subscription Management</h2>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search subscriptions..."
                    value={subscriptionSearch}
                    onChange={(e) => setSubscriptionSearch(e.target.value)}
                    className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  />
                </div>
                <button
                  onClick={loadSubscriptions}
                  className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <RefreshCw className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left py-3 px-6 font-medium text-gray-700">User</th>
                      <th className="text-left py-3 px-6 font-medium text-gray-700">Restaurant</th>
                      <th className="text-left py-3 px-6 font-medium text-gray-700">Plan</th>
                      <th className="text-left py-3 px-6 font-medium text-gray-700">Status</th>
                      <th className="text-left py-3 px-6 font-medium text-gray-700">Period End</th>
                      <th className="text-right py-3 px-6 font-medium text-gray-700">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredSubscriptions.map((subscription) => (
                      <tr key={subscription.id} className="hover:bg-gray-50">
                        <td className="py-4 px-6">
                          <p className="font-medium text-gray-900">{subscription.user_email}</p>
                          <p className="text-sm text-gray-600">ID: {subscription.user_id.slice(-8)}</p>
                        </td>
                        <td className="py-4 px-6">
                          <p className="text-gray-900">{subscription.restaurant_name}</p>
                        </td>
                        <td className="py-4 px-6">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            subscription.plan_type === 'trial' ? 'bg-blue-100 text-blue-800' :
                            subscription.plan_type === 'monthly' ? 'bg-green-100 text-green-800' :
                            subscription.plan_type === 'semiannual' ? 'bg-purple-100 text-purple-800' :
                            'bg-yellow-100 text-yellow-800'
                          }`}>
                            {subscription.plan_type.charAt(0).toUpperCase() + subscription.plan_type.slice(1)}
                          </span>
                        </td>
                        <td className="py-4 px-6">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            subscription.status === 'active' ? 'bg-green-100 text-green-800' :
                            subscription.status === 'expired' ? 'bg-red-100 text-red-800' :
                            subscription.status === 'cancelled' ? 'bg-gray-100 text-gray-800' :
                            'bg-yellow-100 text-yellow-800'
                          }`}>
                            {subscription.status.charAt(0).toUpperCase() + subscription.status.slice(1)}
                          </span>
                        </td>
                        <td className="py-4 px-6 text-gray-600">
                          {formatDate(subscription.current_period_end)}
                        </td>
                        <td className="py-4 px-6 text-right">
                          <button className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
                            <MoreVertical className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Support Tab */}
        {activeTab === 'support' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900">Support Management</h2>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search tickets..."
                    value={ticketSearch}
                    onChange={(e) => setTicketSearch(e.target.value)}
                    className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                  />
                </div>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                >
                  <option value="all">All Status</option>
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-300px)]">
              {/* Tickets List */}
              <div className="bg-white border border-gray-200 rounded-xl flex flex-col">
                <div className="p-4 border-b border-gray-200">
                  <h3 className="font-semibold text-gray-900">Support Tickets</h3>
                  <p className="text-sm text-gray-600">{filteredTickets.length} tickets</p>
                </div>
                
                <div className="flex-1 overflow-y-auto">
                  {filteredTickets.length === 0 ? (
                    <div className="p-4 text-center">
                      <MessageSquare className="h-12 w-12 text-gray-300 mx-auto mb-2" />
                      <p className="text-gray-500">No tickets found</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-gray-200">
                      {filteredTickets.map((ticket) => (
                        <button
                          key={ticket.id}
                          onClick={() => setSelectedTicket(ticket)}
                          className={`w-full p-4 text-left hover:bg-gray-50 transition-colors ${
                            selectedTicket?.id === ticket.id ? 'bg-red-50 border-r-2 border-red-500' : ''
                          }`}
                        >
                          <div className="flex items-start justify-between mb-2">
                            <h4 className="font-medium text-gray-900 text-sm line-clamp-1">
                              {ticket.title}
                            </h4>
                            <div className="flex gap-1">
                              <span className={`text-xs px-2 py-1 rounded-full ${getStatusColor(ticket.status)}`}>
                                {ticket.status.replace('_', ' ')}
                              </span>
                            </div>
                          </div>
                          <p className="text-xs text-gray-600 line-clamp-2 mb-2">
                            {ticket.description}
                          </p>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs px-2 py-1 rounded-full ${getPriorityColor(ticket.priority)}`}>
                                {ticket.priority}
                              </span>
                              <span className="text-xs text-gray-500">
                                {ticket.restaurant?.name || 'Unknown Restaurant'}
                              </span>
                            </div>
                            <span className="text-xs text-gray-500">
                              {formatDate(ticket.created_at)}
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Chat Area */}
              <div className="lg:col-span-2 bg-white border border-gray-200 rounded-xl flex flex-col">
                {selectedTicket ? (
                  <>
                    {/* Chat Header */}
                    <div className="p-4 border-b border-gray-200">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-semibold text-gray-900">{selectedTicket.title}</h3>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`text-xs px-2 py-1 rounded-full ${getStatusColor(selectedTicket.status)}`}>
                              {selectedTicket.status.replace('_', ' ')}
                            </span>
                            <span className={`text-xs px-2 py-1 rounded-full ${getPriorityColor(selectedTicket.priority)}`}>
                              {selectedTicket.priority}
                            </span>
                            <span className="text-xs text-gray-500">
                              {selectedTicket.restaurant?.name}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            value={selectedTicket.status}
                            onChange={(e) => handleUpdateTicketStatus(selectedTicket.id, e.target.value)}
                            className="px-3 py-1 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent"
                          >
                            <option value="open">Open</option>
                            <option value="in_progress">In Progress</option>
                            <option value="resolved">Resolved</option>
                            <option value="closed">Closed</option>
                          </select>
                          <button
                            onClick={() => {
                              setSelectedTicket(null);
                              if (subscriptionRef.current) {
                                subscriptionRef.current.unsubscribe();
                                subscriptionRef.current = null;
                              }
                            }}
                            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                      
                      <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                        <p className="text-sm text-gray-700">{selectedTicket.description}</p>
                      </div>
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                      {messages.map((message) => (
                        <div
                          key={message.id}
                          className={`flex ${message.sender_type === 'super_admin' ? 'justify-end' : 'justify-start'}`}
                        >
                          <div className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                            message.sender_type === 'super_admin'
                              ? 'bg-red-600 text-white'
                              : 'bg-gray-200 text-gray-900'
                          }`}>
                            <p className="text-sm">{message.message}</p>
                            <p className={`text-xs mt-1 ${
                              message.sender_type === 'super_admin' ? 'text-red-200' : 'text-gray-500'
                            }`}>
                              {formatDate(message.created_at)}
                            </p>
                          </div>
                        </div>
                      ))}
                      <div ref={messagesEndRef} />
                    </div>

                    {/* Message Input */}
                    <div className="p-4 border-t border-gray-200">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newMessage}
                          onChange={(e) => setNewMessage(e.target.value)}
                          onKeyPress={(e) => e.key === 'Enter' && !sendingMessage && handleSendMessage()}
                          placeholder="Type your response..."
                          className="flex-1 px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                        />
                        <button
                          onClick={handleSendMessage}
                          disabled={sendingMessage || !newMessage.trim()}
                          className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                          {sendingMessage ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="text-center">
                      <MessageSquare className="h-16 w-16 text-gray-300 mx-auto mb-4" />
                      <h3 className="text-lg font-semibold text-gray-900 mb-2">Select a Ticket</h3>
                      <p className="text-gray-500">Choose a support ticket to view the conversation</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SuperAdminUI;