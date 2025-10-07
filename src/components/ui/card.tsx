
import React from 'react';
export const Card: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({children, ...props}) => <div {...props} style={{background:'#fff', border:'1px solid #eee', borderRadius:16}}>{children}</div>;
export const CardHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({children, ...props}) => <div {...props} style={{padding:16, borderBottom:'1px solid #f0f0f0'}}>{children}</div>;
export const CardTitle: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({children, ...props}) => <div {...props} style={{fontWeight:700}}>{children}</div>;
export const CardContent: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({children, ...props}) => <div {...props} style={{padding:16}}>{children}</div>;
