import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function BankAccounts() {
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [bankName, setBankName] = useState<string>('');
  const [accountName, setAccountName] = useState<string>('');
  const [accountNumber, setAccountNumber] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    fetchAccounts();
    checkAdminRole();
  }, []);

  async function checkAdminRole() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      // Simple check or match against your admin user setup
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single();
      
      if (profile && profile.is_admin) {
        setIsAdmin(true);
      }
    }
  }

  async function fetchAccounts() {
    const { data, error } = await supabase
      .from('bank_accounts')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (data) setAccounts(data);
  }

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();

    if (editingId) {
      const { error } = await supabase
        .from('bank_accounts')
        .update({ bank_name: bankName, account_name: accountName, account_number: accountNumber })
        .eq('id', editingId);

      if (error) alert('Error updating: ' + error.message);
      else {
        setEditingId(null);
        resetForm();
        fetchAccounts();
      }
    } else {
      const { error } = await supabase
        .from('bank_accounts')
        .insert([{ bank_name: bankName, account_name: accountName, account_number: accountNumber, is_active: false }]);

      if (error) alert('Error adding: ' + error.message);
      else {
        resetForm();
        fetchAccounts();
      }
    }
  };

  const handleEdit = (acc: any) => {
    setEditingId(acc.id);
    setBankName(acc.bank_name);
    setAccountName(acc.account_name);
    setAccountNumber(acc.account_number);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this bank account?')) {
      const { error } = await supabase.from('bank_accounts').delete().eq('id', id);
      if (error) alert('Error: ' + error.message);
      else fetchAccounts();
    }
  };

  const handleSetActive = async (id: string) => {
    // First, set all accounts to inactive
    await supabase.from('bank_accounts').update({ is_active: false }).neq('id', '0');
    // Then set the selected one to active
    const { error } = await supabase.from('bank_accounts').update({ is_active: true }).eq('id', id);

    if (error) alert('Error setting default: ' + error.message);
    else fetchAccounts();
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(id);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const resetForm = () => {
    setBankName('');
    setAccountName('');
    setAccountNumber('');
    setEditingId(null);
  };

  const activeAccount = accounts.find(acc => acc.is_active);

  return (
    <div className="p-6 max-w-xl mx-auto bg-white rounded shadow my-6">
      <h2 className="text-2xl font-bold mb-6">Nigeria Bank Account</h2>

      {/* USER VIEW: Only sees the active company bank account */}
      {!isAdmin && (
        <div>
          {activeAccount ? (
            <div className="p-4 border border-blue-200 bg-blue-50 rounded-lg">
              <h3 className="font-semibold text-blue-900 mb-2">Active Transfer Account</h3>
              <p className="text-sm text-gray-700"><strong>Bank Name:</strong> {activeAccount.bank_name}</p>
              <p className="text-sm text-gray-700"><strong>Account Name:</strong> {activeAccount.account_name}</p>
              <div className="flex justify-between items-center mt-2">
                <p className="text-sm text-gray-700"><strong>Account Number:</strong> <span className="font-mono text-base font-bold">{activeAccount.account_number}</span></p>
                <button 
                  onClick={() => copyToClipboard(activeAccount.account_number, activeAccount.id)}
                  className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded hover:bg-blue-700"
                >
                  {copiedField === activeAccount.id ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No active company bank account available at the moment.</p>
          )}
        </div>
      )}

      {/* ADMIN VIEW: Complete CRUD control */}
      {isAdmin && (
        <div>
          <form onSubmit={handleSaveAccount} className="mb-6 p-4 bg-gray-50 border rounded">
            <h3 className="font-bold mb-3">{editingId ? 'Edit Bank Account' : 'Add New Bank Account'}</h3>
            <div className="mb-3">
              <label className="block text-sm font-medium mb-1">Bank Name</label>
              <input 
                type="text" 
                value={bankName} 
                onChange={(e) => setBankName(e.target.value)} 
                className="w-full p-2 border rounded text-sm" 
                required 
              />
            </div>
            <div className="mb-3">
              <label className="block text-sm font-medium mb-1">Account Name</label>
              <input 
                type="text" 
                value={accountName} 
                onChange={(e) => setAccountName(e.target.value)} 
                className="w-full p-2 border rounded text-sm" 
                required 
              />
            </div>
            <div className="mb-3">
              <label className="block text-sm font-medium mb-1">Account Number</label>
              <input 
                type="text" 
                value={accountNumber} 
                onChange={(e) => setAccountNumber(e.target.value)} 
                className="w-full p-2 border rounded text-sm" 
                required 
              />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="bg-red-600 text-white px-4 py-2 rounded text-sm hover:bg-red-700">
                {editingId ? 'Update Account' : 'Add Account'}
              </button>
              {editingId && (
                <button type="button" onClick={resetForm} className="bg-gray-300 text-gray-800 px-4 py-2 rounded text-sm">
                  Cancel
                </button>
              )}
            </div>
          </form>

          <h3 className="font-bold mb-3">All Managed Accounts</h3>
          <div className="space-y-3">
            {accounts.map((acc) => (
              <div key={acc.id} className={`p-4 border rounded flex justify-between items-center ${acc.is_active ? 'border-green-500 bg-green-50' : 'bg-white'}`}>
                <div>
                  <p className="text-sm font-bold">{acc.bank_name} {acc.is_active && <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded ml-2">Active</span>}</p>
                  <p className="text-sm text-gray-600">{acc.account_name}</p>
                  <p className="text-sm font-mono font-semibold">{acc.account_number}</p>
                </div>
                <div className="flex flex-col gap-1 text-xs">
                  {!acc.is_active && (
                    <button onClick={() => handleSetActive(acc.id)} className="bg-green-600 text-white px-2 py-1 rounded hover:bg-green-700">
                      Set Default
                    </button>
                  )}
                  <button onClick={() => handleEdit(acc)} className="bg-amber-500 text-white px-2 py-1 rounded hover:bg-amber-600">
                    Edit
                  </button>
                  <button onClick={() => handleDelete(acc.id)} className="bg-red-500 text-white px-2 py-1 rounded hover:bg-red-600">
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}