import React, { useState, useEffect, useCallback, useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { reportError } from "../../utils/helpers";
import dataService from "../../utils/dataService";

function AnimatedCounter({ end, duration = 1200, suffix = "" }) {
    const [count, setCount] = useState(0);
    const ref = useRef(null);

    useEffect(() => {
        if (end <= 0) { setCount(0); return; }
        let start = 0;
        const startTime = performance.now();
        const step = (now) => {
            const progress = Math.min((now - startTime) / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3); // easeOutCubic
            setCount(Math.round(eased * end));
            if (progress < 1) ref.current = requestAnimationFrame(step);
        };
        ref.current = requestAnimationFrame(step);
        return () => ref.current && cancelAnimationFrame(ref.current);
    }, [end, duration]);

    return <span>{count.toLocaleString()}{suffix}</span>;
}

const STAT_CONFIG = [
    { key: "meals_shared", label: "Meals Shared", icon: "🍽️", color: "text-green-600", bg: "bg-green-50" },
    { key: "co2_prevented", label: "CO₂ Prevented", icon: "🌿", color: "text-emerald-600", bg: "bg-emerald-50", suffix: " kg" },
    { key: "water_saved", label: "Water Saved", icon: "💧", color: "text-blue-600", bg: "bg-blue-50", suffix: " L" },
    { key: "people_helped", label: "People Helped", icon: "🤝", color: "text-purple-600", bg: "bg-purple-50" },
];

export default function ImpactStats({ userId }) {
    const [stats, setStats] = useState(null);
    const [monthlyData, setMonthlyData] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchImpact = useCallback(async () => {
        if (!userId) return;
        setLoading(true);
        try {
            const impact = await dataService.getUserImpact(userId);
            if (impact) {
                setStats({
                    meals_shared: impact.meals_shared || impact.total_donations || 0,
                    co2_prevented: impact.co2_prevented || Math.round((impact.total_donations || 0) * 2.5),
                    water_saved: impact.water_saved || Math.round((impact.total_donations || 0) * 15),
                    people_helped: impact.people_helped || impact.total_recipients || 0,
                });
                // Build monthly chart data
                if (impact.monthly_stats && Array.isArray(impact.monthly_stats)) {
                    setMonthlyData(impact.monthly_stats.slice(-6).map(m => ({
                        month: m.month || m.label,
                        meals: m.count || m.meals || 0,
                    })));
                }
            }
        } catch (err) {
            console.error("Failed to load impact stats:", err);
            reportError(err);
            // Fallback
            setStats({ meals_shared: 0, co2_prevented: 0, water_saved: 0, people_helped: 0 });
        } finally {
            setLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        fetchImpact();
    }, [fetchImpact]);

    if (loading) {
        return (
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
                <h3 className="text-lg font-bold text-gray-900 mb-4">📊 Your Impact</h3>
                <div className="grid grid-cols-2 gap-3">
                    {[1, 2, 3, 4].map(i => (
                        <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />
                    ))}
                </div>
            </div>
        );
    }

    if (!stats) return null;

    return (
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <h3 className="text-lg font-bold text-gray-900 mb-4">📊 Your Impact</h3>

            {/* Stat cards */}
            <div className="grid grid-cols-2 gap-3 mb-5">
                {STAT_CONFIG.map(cfg => (
                    <div
                        key={cfg.key}
                        className={`${cfg.bg} rounded-xl p-3 text-center`}
                    >
                        <div className="text-2xl mb-1">{cfg.icon}</div>
                        <div className={`text-xl font-bold ${cfg.color}`}>
                            <AnimatedCounter end={stats[cfg.key] || 0} suffix={cfg.suffix || ""} />
                        </div>
                        <div className="text-[11px] text-gray-500 font-medium mt-0.5">{cfg.label}</div>
                    </div>
                ))}
            </div>

            {/* Monthly chart */}
            {monthlyData.length > 0 && (
                <div>
                    <p className="text-xs text-gray-500 font-medium mb-2">Monthly meals shared</p>
                    <ResponsiveContainer width="100%" height={120}>
                        <BarChart data={monthlyData}>
                            <XAxis
                                dataKey="month"
                                tick={{ fontSize: 10, fill: "#9CA3AF" }}
                                axisLine={false}
                                tickLine={false}
                            />
                            <YAxis hide />
                            <Tooltip
                                contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #E5E7EB" }}
                                formatter={(v) => [`${v} meals`, ""]}
                            />
                            <Bar dataKey="meals" fill="#2CABE3" radius={[4, 4, 0, 0]} />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            )}

            {/* Badges */}
            {stats.meals_shared >= 10 && (
                <div className="mt-4 flex flex-wrap gap-2">
                    {stats.meals_shared >= 10 && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-50 text-amber-700 text-[10px] font-bold rounded-full border border-amber-200">
                            🏅 10+ Meals
                        </span>
                    )}
                    {stats.meals_shared >= 50 && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-50 text-amber-700 text-[10px] font-bold rounded-full border border-amber-200">
                            🏆 50+ Meals
                        </span>
                    )}
                    {stats.meals_shared >= 100 && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-50 text-amber-700 text-[10px] font-bold rounded-full border border-amber-200">
                            👑 100+ Meals Hero
                        </span>
                    )}
                    {stats.co2_prevented >= 1000 && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-50 text-green-700 text-[10px] font-bold rounded-full border border-green-200">
                            🌍 1 Ton CO₂ Prevented
                        </span>
                    )}
                </div>
            )}
        </div>
    );
}
