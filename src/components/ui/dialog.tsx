
import React from 'react';
export const Dialog: React.FC<{open?:boolean, onOpenChange?:(v:boolean)=>void, children:any}> = ({children}) => <>{children}</>;
export const DialogTrigger: React.FC<{asChild?:boolean, children:any}> = ({children}) => <>{children}</>;
export const DialogContent: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({children, ...props}) => <div {...props} style={{position:'fixed', inset:0, display:'grid', placeItems:'center'}}><div style={{background:'#fff', padding:16, borderRadius:12, minWidth:320, maxWidth:560}}>{children}</div></div>;
export const DialogHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({children}) => <div style={{marginBottom:8}}>{children}</div>;
export const DialogTitle: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({children}) => <div style={{fontWeight:700}}>{children}</div>;
export const DialogFooter: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({children}) => <div style={{display:'flex', gap:8, justifyContent:'flex-end', marginTop:12}}>{children}</div>;
