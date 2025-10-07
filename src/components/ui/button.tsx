
import React from 'react';
export const Button: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & {variant?: string, size?: string}> = ({children, ...props}) => (
  <button {...props} style={{padding:'8px 12px', borderRadius:8, border: props.variant==='outline'?'1px solid #ddd':'none', background: props.variant==='secondary'?'#eee':'#166534', color: props.variant==='secondary'?'#111':'#fff'}}>{children}</button>
);
export default Button;
