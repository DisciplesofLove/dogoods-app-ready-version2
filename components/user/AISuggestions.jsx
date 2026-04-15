import React, { useState, useEffect, useCallback } from "react";
import { API_CONFIG } from "../../utils/config";
import { reportError } from "../../utils/helpers";

const SUGGESTION_ICONS = {
    food_available: "🍎",
    donate_suggestion: "🤝",
    impact_summary: "🌟",
    community_tip: "💡",
    default: "✨",
};

const SUGGESTION_COLORS = {
    food_available: "from-green-50 to-emerald-50 border-green-200",
    donate_suggestion: "from-blue-50 to-cyan-50 border-blue-200",
    impact_summary: "from-amber-50 to-yellow-50 border-amber-200",
    community_tip: "from-purple-50 to-pink-50 border-purple-200",
    default: "from-gray-50 to-slate-50 border-gray-200",
};

export default function AISuggestions({ userId }) {
    const [suggestions, setSuggestions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchSuggestions = useCallback(async () => {
        if (!userId) return;
        setLoading(true);
        setError(null);
        try {
            const res = await fetch(
                `${API_CONFIG.BACKEND_URL}/api/ai/suggestions/${encodeURIComponent(userId)}`
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            setSuggestions(data.suggestions || []);
        } catch (err) {
            console.error("Failed to load AI suggestions:", err);
            setError("Couldn't load suggestions right now");
            reportError(err);
            // Fallback suggestions
            setSuggestions([
                { type: "food_available", title: "Food near you", message: "Check out available food in your area — new items are posted daily!" },
                { type: "donate_suggestion", title: "Share surplus food", message: "Got extra food? Share it with your community and help reduce waste." },
                { type: "impact_summary", title: "Your impact matters", message: "Every meal shared helps bridge the hunger gap. Keep going!" },
            ]);
        } finally {
            setLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        fetchSuggestions();
    }, [fetchSuggestions]);

    if (loading) {
        return (
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-gray-900">✨ AI Suggestions</h3>
                </div>
                <div className="space-y-3">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900">✨ AI Suggestions</h3>
                <button
                    onClick={fetchSuggestions}
                    className="text-xs text-[#2CABE3] hover:text-[#1a8abf] font-medium flex items-center gap-1"
                    title="Refresh suggestions"
                >
                    <i className="fas fa-sync-alt text-[10px]"></i>
                    Refresh
                </button>
            </div>

            {error && !suggestions.length ? (
                <p className="text-sm text-gray-500 text-center py-4">{error}</p>
            ) : (
                <div className="space-y-3">
                    {suggestions.slice(0, 4).map((s, i) => {
                        const type = s.type || "default";
                        const icon = SUGGESTION_ICONS[type] || SUGGESTION_ICONS.default;
                        const color = SUGGESTION_COLORS[type] || SUGGESTION_COLORS.default;
                        return (
                            <div
                                key={i}
                                className={`bg-gradient-to-r ${color} border rounded-xl p-3 transition-all hover:shadow-sm`}
                            >
                                <div className="flex items-start gap-3">
                                    <span className="text-xl flex-shrink-0 mt-0.5">{icon}</span>
                                    <div className="min-w-0">
                                        <p className="font-semibold text-gray-900 text-sm">{s.title}</p>
                                        <p className="text-gray-600 text-xs mt-0.5 line-clamp-2">{s.message}</p>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
