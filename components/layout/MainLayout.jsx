import React from "react";
import Header from "../common/Header";
import Footer from "../common/Footer";
import AIChatPanel from "../assistant/AIChatPanel";
import UserChatWidget from "../common/UserChatWidget";
import Tutorial from "../common/Tutorial";
import { useTutorial } from "../../utils/TutorialContext";

// Module-level flag — survives re-mounts but resets on full page reload
let tutorialAutoStartChecked = false;


function MainLayout({ children }) {
    // const [isAssistantOpen, setIsAssistantOpen] = React.useState(false);

    // const toggleAssistant = () => {
    //     setIsAssistantOpen(!isAssistantOpen);
    // };

    const { isTutorialOpen, startTutorial } = useTutorial();

    // Auto-start tutorial ONLY for first-time visitors.
    // Fires once per full page load; localStorage check prevents repeat visits.
    React.useEffect(() => {
        if (tutorialAutoStartChecked) return;
        tutorialAutoStartChecked = true;

        const alreadyCompleted = localStorage.getItem('dogoods_tutorial_completed') === 'true';
        if (!alreadyCompleted) {
            const timer = setTimeout(() => {
                startTutorial();
            }, 1500);
            return () => clearTimeout(timer);
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div data-name="main-layout" className="min-h-screen flex flex-col bg-gradient-to-br from-cyan-50 via-white to-cyan-100">
            <Header/>
            <main className="flex-grow container mx-auto px-4 py-8">
                <div className="rounded-3xl shadow-2xl bg-white/80 backdrop-blur-md border border-cyan-100 p-6 md:p-10 transition-all duration-300">
                    {children}
                </div>
            </main>
            <Footer />

            {/* Nouri AI Assistant */}
            <AIChatPanel />

            {/* User Chat Widget (for messaging admin) */}
            <UserChatWidget />

            {/* Global Tutorial Overlay */}
            <Tutorial />
        </div>
    );
}


export default MainLayout;
