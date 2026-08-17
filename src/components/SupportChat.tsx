import React, { useState } from 'react';

/**
 * Existing in-app support chat. Navigation/location only — same send + auto-reply behavior.
 */
export default function SupportChat() {
  const [messages, setMessages] = useState<any[]>([
    {
      sender: 'support',
      text: 'Hello! Welcome to KoolMovez support. How can we help you today?',
      time: 'Just now',
    },
  ]);
  const [newMessage, setNewMessage] = useState<string>('');

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    const userMsg = { sender: 'user', text: newMessage.trim(), time: 'Just now' };
    setMessages((prev) => [...prev, userMsg]);
    setNewMessage('');

    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          sender: 'support',
          text: 'Thank you for reaching out. An admin agent is reviewing your message and will update you shortly.',
          time: 'Just now',
        },
      ]);
    }, 1000);
  };

  return (
    <div className="p-5 bg-white rounded-2xl border border-[#E5E7EB] shadow-sm space-y-4">
      <div>
        <h3 className="text-sm font-bold text-[#0F172A]">Live Support & Messaging</h3>
        <p className="text-xs text-gray-600 mt-0.5">
          Chat with the KoolMovez support team about Exchange, Air Freight, or Sea Freight.
        </p>
      </div>

      <div className="h-72 overflow-y-auto p-4 bg-[#F8FAFC] rounded-2xl border border-gray-200 space-y-3 flex flex-col">
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`max-w-[80%] p-3 rounded-xl text-xs space-y-1 ${
              msg.sender === 'user'
                ? 'ml-auto bg-[#10B981] text-white rounded-br-none'
                : 'mr-auto bg-white border border-gray-200 text-gray-800 rounded-bl-none shadow-xs'
            }`}
          >
            <p className="font-semibold">{msg.text}</p>
            <p
              className={`text-[9px] text-right ${
                msg.sender === 'user' ? 'text-emerald-100' : 'text-gray-400'
              }`}
            >
              {msg.time}
            </p>
          </div>
        ))}
      </div>

      <form onSubmit={handleSendMessage} className="flex gap-2">
        <input
          type="text"
          placeholder="Type your message to support..."
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          className="flex-1 min-w-0 p-3 bg-white border border-gray-200 rounded-xl text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#10B981]"
        />
        <button
          type="submit"
          className="shrink-0 px-5 py-3 bg-[#10B981] hover:bg-[#059669] text-white rounded-xl text-xs font-bold shadow-sm transition-all"
        >
          Send
        </button>
      </form>
    </div>
  );
}
