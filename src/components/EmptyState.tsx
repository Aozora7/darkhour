import { useAppContext } from "../useAppContext";
import { Eye } from "lucide-react";

export default function EmptyState() {
    const { data, auth } = useAppContext();
    const signedIn = !!auth.token;

    return (
        <div className="mx-auto mt-16 max-w-md text-center">
            <p className="mb-4 text-lg text-gray-300">No sleep data loaded</p>
            <p className="mb-6 text-sm text-gray-500">
                {signedIn
                    ? "Your account has no sleep records yet. Import a JSON file, or load demo data below."
                    : "Sign in with Google, or import a JSON file using the Import button above."}
            </p>
            <button
                onClick={data.loadDemoData}
                className="inline-flex items-center gap-2 rounded bg-blue-700 px-4 py-2 text-sm text-white hover:bg-blue-600"
            >
                <Eye size={16} strokeWidth={2} />
                Load demo data
            </button>
        </div>
    );
}
