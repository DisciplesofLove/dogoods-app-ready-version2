import supabase from './supabaseClient';

class ImpactService {
    async getAggregatedImpact() {
        try {
            console.log('[ImpactService] Fetching impact data...');
            const { data, error } = await supabase
                .from('impact_data')
                .select('*');

            if (error) {
                console.error('[ImpactService] Error fetching:', error);
                throw error;
            }
            console.log('[ImpactService] Fetched', data?.length || 0, 'records');

            if (!data || data.length === 0) {
                return {
                    totalMealsProvided: 0,
                    foodSavedFromWaste: 0,
                    foodProvided: 0,
                    peopleHelped: 0,
                    schoolsServed: 0,
                    nonprofitsHelped: 0,
                    wasteReduced: 0,
                    co2Saved: 0,
                    volunteerHours: 0
                };
            }

            const aggregated = data.reduce((acc, entry) => {
                const entryPeopleHelped = (parseInt(entry.people_helped) || 0) +
                    (parseInt(entry.families_helped) || 0) +
                    (parseInt(entry.school_staff_helped) || 0);

                return {
                    totalMealsProvided: acc.totalMealsProvided + (parseInt(entry.total_meals_provided) || 0),
                    foodSavedFromWaste: acc.foodSavedFromWaste + (parseFloat(entry.food_saved_from_waste_lb) || 0),
                    foodProvided: acc.foodProvided + (parseFloat(entry.food_provided_lb) || 0),
                    peopleHelped: acc.peopleHelped + entryPeopleHelped,
                    schoolsServed: acc.schoolsServed + (parseInt(entry.schools_served) || 0),
                    nonprofitsHelped: acc.nonprofitsHelped + (parseInt(entry.nonprofits_helped) || 0),
                    wasteReduced: acc.wasteReduced + (parseFloat(entry.waste_diverted_kg) || 0),
                    co2Saved: acc.co2Saved + (parseFloat(entry.co2_reduced_kg) || 0),
                    volunteerHours: acc.volunteerHours + (parseFloat(entry.volunteer_hours) || 0)
                };
            }, {
                totalMealsProvided: 0,
                foodSavedFromWaste: 0,
                foodProvided: 0,
                peopleHelped: 0,
                schoolsServed: 0,
                nonprofitsHelped: 0,
                wasteReduced: 0,
                co2Saved: 0,
                volunteerHours: 0
            });

            console.log('[ImpactService] Aggregated result:', aggregated);
            return aggregated;
        } catch (error) {
            console.error('[ImpactService] Error in getAggregatedImpact:', error);
            return {
                totalMealsProvided: 0,
                foodSavedFromWaste: 0,
                foodProvided: 0,
                peopleHelped: 0,
                schoolsServed: 0,
                nonprofitsHelped: 0,
                wasteReduced: 0,
                co2Saved: 0,
                volunteerHours: 0
            };
        }
    }

    async getImpactByDateRange(startDate, endDate) {
        try {
            const { data, error } = await supabase
                .from('impact_data')
                .select('*')
                .gte('date', startDate)
                .lte('date', endDate)
                .order('date', { ascending: true });

            if (error) throw error;
            return data || [];
        } catch (error) {
            console.error('Error fetching impact by date range:', error);
            return [];
        }
    }

    subscribeToImpactUpdates(callback) {
        console.log('[ImpactService] Setting up real-time subscription...');
        const channel = supabase
            .channel('public:impact_data')
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'impact_data'
                },
                (payload) => {
                    console.log('[ImpactService] 🔥 Real-time update received!', payload);
                    callback(payload);
                }
            )
            .subscribe((status) => {
                console.log('[ImpactService] Subscription status:', status);
            });

        return channel;
    }

    unsubscribeFromImpactUpdates(channel) {
        if (channel) {
            console.log('[ImpactService] Unsubscribing from real-time updates');
            channel.unsubscribe();
            supabase.removeChannel(channel);
        }
    }
}

export default new ImpactService();
