import { useAppContext } from "../useAppContext";
import { Eye, ExternalLink } from "lucide-react";

export default function EmptyState() {
    const { data, auth } = useAppContext();
    const signedIn = !!auth.token;

    return (
        <div className="mx-auto mt-16 max-w-md text-center">
            {data.accountNotLinked ? (
                <>
                    <p className="mb-4 text-lg text-yellow-400">Google Health not linked</p>
                    <p className="mb-4 text-sm text-gray-400">
                        Your Google account is not linked to Google Health Connect. Link it first, then try fetching
                        again.
                    </p>
                    <a
                        href="https://fitbit.google.com/auth/signup"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mb-6 inline-flex items-center gap-2 rounded bg-blue-700 px-4 py-2 text-sm text-white hover:bg-blue-600"
                    >
                        <ExternalLink size={16} strokeWidth={2} />
                        Link Google Health
                    </a>
                    <p className="mb-6 text-sm text-gray-500">Or load demo data to preview the app without linking.</p>
                </>
            ) : (
                <>
                    <p className="mb-4 text-lg text-gray-300">No sleep data loaded</p>
                    <p className="mb-6 text-sm text-gray-500">
                        {signedIn
                            ? "Your account has no sleep records yet. Import a JSON file, or load demo data below."
                            : "Sign in with Google Health Connect, or import a JSON file using the Import button above."}
                    </p>
                </>
            )}
            <button
                onClick={data.loadDemoData}
                className="inline-flex items-center gap-2 rounded bg-green-700 px-4 py-2 text-sm text-white hover:bg-green-600"
            >
                <Eye size={16} strokeWidth={2} />
                Load demo data
            </button>
        </div>
    );
}
