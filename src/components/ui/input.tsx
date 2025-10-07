
import React from 'react';
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>((props, ref) => (
  <input ref={ref} {...props} style={{padding:'8px 10px', borderRadius:8, border:'1px solid #ddd'}} />
));
Input.displayName='Input';
