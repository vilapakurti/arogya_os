import { ModulePlaceholder } from "@/components/app/module-placeholder";
import { Mic } from "lucide-react";

export default function VoiceAssistant() {
  return (
    <ModulePlaceholder
      icon={Mic}
      title="Voice Assistant"
      description="Speak in your own language — Hindi, Tamil, Marathi and more — and get health answers grounded in your own records."
    />
  );
}
