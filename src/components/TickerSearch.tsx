import React from "react";
import { Search, Loader2 } from "lucide-react";
import { cn } from "@/src/lib/utils";

interface TickerSearchProps {
  onSelect: (ticker: string, name: string) => void;
  className?: string;
  placeholder?: string;
  initialValue?: string;
}

export default function TickerSearch({ onSelect, className, placeholder = "Search ticker...", initialValue = "" }: TickerSearchProps) {
  const [query, setQuery] = React.useState(initialValue);
  const [results, setResults] = React.useState<any[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [showResults, setShowResults] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSearch = async (val: string) => {
    setQuery(val);
    if (val.length < 1) {
      setResults([]);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(val)}`);
      if (response.ok) {
        const data = await response.json();
        setResults(data.result || []);
        setShowResults(true);
      }
    } catch (error) {
      console.error("Search error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("relative", className)} ref={containerRef}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#141414]/30" size={16} />
        <input
          type="text"
          className="w-full bg-[#141414]/5 border-none rounded-xl pl-10 pr-4 py-2 text-sm font-mono focus:ring-2 focus:ring-[#141414]/10 transition-all"
          placeholder={placeholder}
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          onFocus={() => query.length > 0 && setShowResults(true)}
        />
        {isLoading && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-[#141414]/30" size={16} />
        )}
      </div>

      {showResults && results.length > 0 && (
        <div className="absolute z-50 w-full mt-2 bg-white border border-[#141414]/10 rounded-2xl shadow-xl overflow-hidden max-h-60 overflow-y-auto">
          {results.map((res, index) => (
            <button
              key={`${res.symbol}-${index}`}
              type="button"
              className="w-full px-4 py-3 text-left hover:bg-[#141414]/5 transition-colors flex flex-col border-b border-[#141414]/5 last:border-none"
              onClick={() => {
                onSelect(res.symbol, res.description);
                setQuery(res.symbol);
                setShowResults(false);
              }}
            >
              <span className="font-bold font-mono text-sm">{res.symbol}</span>
              <span className="text-[10px] opacity-50 truncate">{res.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
