
import React from 'react';
export const Badge: React.FC<React.HTMLAttributes<HTMLSpanElement> & {variant?:string}> = ({children, ...props}) => <span {...props} style={{padding:'4px 8px', borderRadius:999, background:'#eee'}}>{children}</span>;
