// src/hooks/usePricing.ts
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface WorkspaceType {
  id: string;
  name: string;
  price: number;
  price_unit: string;
}

interface DurationDiscount {
  id: string;
  workspace_type_id: string;
  duration: string;
  discount_percentage: number;
  fixed_price: number | null;
  is_active: boolean;
}

interface DurationOption {
  value: string;
  label: string;
  multiplier: number;
  originalPrice: number;
  discountedPrice: number;
  discount: number;
  hasDiscount: boolean;
}

export const usePricing = () => {
  const [workspaceTypes, setWorkspaceTypes] = useState<WorkspaceType[]>([]);
  const [durationDiscounts, setDurationDiscounts] = useState<DurationDiscount[]>([]);
  const [loading, setLoading] = useState(true);
  const [siteBookingDurations, setSiteBookingDurations] = useState<string[]>([]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      
      const [workspaceResult, discountResult, siteSettingsResult] = await Promise.all([
        supabase
          .from('workspace_types')
          .select('id, name, price, price_unit')
          .eq('is_active', true)
          .order('price', { ascending: true }),
        supabase
          .from('duration_discounts')
          .select('*')
          .eq('is_active', true),
        supabase
          .from('site_settings')
          .select('value')
          .eq('key', 'booking_durations')
          .single()
      ]);

      if (workspaceResult.error) throw workspaceResult.error;
      if (discountResult.error) throw discountResult.error;
      if (siteSettingsResult.error && siteSettingsResult.error.code !== 'PGRST116') {
        console.error('Error fetching site settings for booking durations:', siteSettingsResult.error);
      }

      setWorkspaceTypes(workspaceResult.data || []);
      setDurationDiscounts(discountResult.data || []);

      const fetchedDurations = siteSettingsResult.data?.value
        ? siteSettingsResult.data.value.split(',').map(d => d.trim()).filter(Boolean)
        : ['1 hour', '2 hours', '3 hours', '4 hours', '5 hours', '6 hours'];
      setSiteBookingDurations(fetchedDurations);

    } catch (error) {
      console.error('Error fetching pricing data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Modified getDurationOptions to accept isAdminContext
  const getDurationOptions = (workspaceTypeName: string, isAdminContext: boolean = false): DurationOption[] => {
    const workspace = workspaceTypes.find(w => w.name === workspaceTypeName);
    if (!workspace) return [];

    // Filter out any 'undefined' or 'undefined duration' strings from site settings
    const filteredSiteDurations = siteBookingDurations.filter(d => 
      d.toLowerCase() !== 'undefined' && !d.toLowerCase().includes('undefined duration')
    );

    const baseDurations = filteredSiteDurations.map(durationStr => {
      const match = durationStr.match(/(\d+)\s*hours?/i);
      const multiplier = match ? parseInt(match[1]) : 1;
      return { value: durationStr, label: durationStr.charAt(0).toUpperCase() + durationStr.slice(1), multiplier };
    });

    const options = baseDurations.map(duration => {
      const originalPrice = workspace.price * duration.multiplier;
      const discount = durationDiscounts.find(
        d => d.workspace_type_id === workspace.id && d.duration === duration.value
      );

      let discountedPrice = originalPrice;
      let discountAmount = 0;
      let hasDiscount = false;

      if (discount) {
        if (discount.fixed_price !== null && discount.fixed_price > 0) {
          discountedPrice = discount.fixed_price;
          discountAmount = originalPrice - discount.fixed_price;
          hasDiscount = discountAmount > 0;
        } else if (discount.discount_percentage > 0) {
          discountAmount = (originalPrice * discount.discount_percentage) / 100;
          discountedPrice = originalPrice - discountAmount;
          hasDiscount = true;
        }
      }

      return {
        value: duration.value,
        label: duration.label,
        multiplier: duration.multiplier,
        originalPrice,
        discountedPrice,
        discount: discountAmount,
        hasDiscount
      };
    });

    // Conditionally add the "Undefined" duration option only for admin context
    if (isAdminContext) {
      options.push({
        value: 'undefined',
        label: 'Undefined Duration (Open Session)',
        multiplier: 0,
        originalPrice: workspace.price,
        discountedPrice: workspace.price,
        discount: 0,
        hasDiscount: false
      });
    }

    return options;
  };

  const calculatePrice = (workspaceTypeName: string, duration: string): number => {
    const workspace = workspaceTypes.find(w => w.name === workspaceTypeName);
    if (!workspace) return 0;

    if (duration === 'undefined') {
      return workspace.price;
    }

    // Call getDurationOptions without isAdminContext for general price calculation
    const durationOption = getDurationOptions(workspaceTypeName).find(d => d.value === duration);
    return durationOption ? durationOption.discountedPrice : 0;
  };

  const getPriceBreakdown = (workspaceTypeName: string, duration: string) => {
    const workspace = workspaceTypes.find(w => w.name === workspaceTypeName);
    if (!workspace) return null;

    if (duration === 'undefined') {
      return {
        originalPrice: workspace.price,
        discountedPrice: workspace.price,
        discount: 0,
        hasDiscount: false,
        workspace: workspace,
        isUndefinedDuration: true
      };
    }

    // Call getDurationOptions without isAdminContext for general price breakdown
    const durationOption = getDurationOptions(workspaceTypeName).find(d => d.value === duration);
    if (!durationOption) return null;

    return {
      originalPrice: durationOption.originalPrice,
      discountedPrice: durationOption.discountedPrice,
      discount: durationOption.discount,
      hasDiscount: durationOption.hasDiscount,
      workspace: workspace,
      isUndefinedDuration: false
    };
  };

  const refreshData = () => {
    fetchData();
  };

  return {
    workspaceTypes,
    durationDiscounts,
    loading,
    getDurationOptions,
    calculatePrice,
    getPriceBreakdown,
    refreshData
  };
};
