import TeamsTable from '@/components/TeamsTable';
import Header from '@/components/Header';

export const metadata = {
    title: 'Team Stats',
    description: 'Advanced NHL team statistics including xG, PP/PK performance, and more.',
};

export default function TeamsPage() {
    return (
        <main className="min-h-screen bg-black text-white px-3 font-sans relative selection:bg-emerald-500/30">
            {/* Background Ambient Glow */}
            <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-blue-900/20 blur-[120px] rounded-full pointer-events-none z-0"></div>

            <div className="relative z-10">
                <Header compact />

                <TeamsTable />
            </div>
        </main>
    );
}
