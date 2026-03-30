import React from "react";
import { X, AlertTriangle } from "lucide-react";
import { cn } from "@/src/lib/utils";

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
}

export default function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  isDestructive = true
}: ConfirmationModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl p-8 max-w-md w-full space-y-6 shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-red-600">
            <AlertTriangle size={24} />
            <h3 className="text-xl font-bold italic serif">{title}</h3>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-[#141414]/5 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>
        
        <p className="text-sm opacity-70 leading-relaxed">
          {message}
        </p>

        <div className="flex gap-3 pt-4">
          <button
            onClick={onClose}
            className="flex-1 px-6 py-3 rounded-xl font-bold border border-[#141414]/10 hover:bg-[#141414]/5 transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={cn(
              "flex-1 px-6 py-3 rounded-xl font-bold text-white transition-all shadow-lg",
              isDestructive ? "bg-red-600 hover:bg-red-700 shadow-red-600/20" : "bg-[#141414] hover:bg-[#141414]/90 shadow-[#141414]/20"
            )}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
