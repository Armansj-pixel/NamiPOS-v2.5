
import React from 'react';
export const Tabs: React.FC<{defaultValue:string, children:any}> = ({children}) => <div data-tabs>{children}</div>;
export const TabsList: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({children,...props}) => <div {...props} style={{display:'flex', gap:8, marginBottom:8}}>{children}</div>;
export const TabsTrigger: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & {value:string}> = ({children, ...props}) => <button {...props} style={{padding:'6px 10px', borderRadius:8, border:'1px solid #ddd', background:'#fff'}}>{children}</button>;
export const TabsContent: React.FC<React.HTMLAttributes<HTMLDivElement> & {value:string}> = ({children,...props}) => <div {...props}>{children}</div>;
