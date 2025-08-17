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
  const [siteBookingDurations, setSiteBookingDurations] = useState<string[]>([]); // New state for site settings durations

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      
      const [workspaceResult, discountResult, siteSettingsResult] = await Promise.all([ // Added siteSettingsResult
        supabase
          .from('workspace_types')
          .select('id, name, price, price_unit')
          .eq('is_active', true)
          .order('price', { ascending: true }),
        supabase
          .from('duration_discounts')
          .select('*')
          .eq('is_active', true),
        supabase // Fetch site settings for booking durations
          .from('site_settings')
          .select('value')
          .eq('key', 'booking_durations')
          .single()
      ]);

      if (workspaceResult.error) throw workspaceResult.error;
      if (discountResult.error) throw discountResult.error;
      if (siteSettingsResult.error && siteSettingsResult.error.code !== 'PGRST116') { // Allow no rows found
        console.error('Error fetching site settings for booking durations:', siteSettingsResult.error);
        // Don't throw, use default if setting not found
      }

      setWorkspaceTypes(workspaceResult.data || []);
      setDurationDiscounts(discountResult.data || []);

      // Parse site settings durations
      const fetchedDurations = siteSettingsResult.data?.value
        ? siteSettingsResult.data.value.split(',').map(d => d.trim()).filter(Boolean)
        : ['1 hour', '2 hours', '3 hours', '4 hours', '5 hours', '6 hours']; // Default if not set
      setSiteBookingDurations(fetchedDurations);

    } catch (error) {
      console.error('Error fetching pricing data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getDurationOptions = (workspaceTypeName: string): DurationOption[] => {
    const workspace = workspaceTypes.find(w => w.name === workspaceTypeName);
    if (!workspace) return [];

    // Use siteBookingDurations for baseDurations
    const baseDurations = siteBookingDurations.map(durationStr => {
      const match = durationStr.match(/(\d+)\s*hours?/i);
      const multiplier = match ? parseInt(match[1]) : 1; // Default to 1 if parsing fails
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

    // Add the "Undefined" duration option
    options.push({
      value: 'undefined',
      label: 'Undefined Duration (Open Session)', // More descriptive label
      multiplier: 0, // Not applicable for fixed duration
      originalPrice: workspace.price, // Base hourly price
      discountedPrice: workspace.price, // Base hourly price, no discount
      discount: 0,
      hasDiscount: false
    });

    return options;
  };

  const calculatePrice = (workspaceTypeName: string, duration: string): number => {
    const workspace = workspaceTypes.find(w => w.name === workspaceTypeName);
    if (!workspace) return 0;

    if (duration === 'undefined') {
      return workspace.price; // Return base hourly price for undefined duration
    }

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
        isUndefinedDuration: true // Indicate this is an undefined duration
      };
    }

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
