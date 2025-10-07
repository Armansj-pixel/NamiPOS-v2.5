
import React from 'react';
export const Table: React.FC<React.HTMLAttributes<HTMLTableElement>> = ({children,...props}) => <table {...props} style={{width:'100%', borderCollapse:'collapse'}}>{children}</table>;
export const TableHeader: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({children,...props}) => <thead {...props} style={{background:'#f8f8f8'}}>{children}</thead>;
export const TableBody: React.FC<React.HTMLAttributes<HTMLTableSectionElement>> = ({children,...props}) => <tbody {...props}>{children}</tbody>;
export const TableRow: React.FC<React.HTMLAttributes<HTMLTableRowElement>> = ({children,...props}) => <tr {...props} />;
export const TableHead: React.FC<React.ThHTMLAttributes<HTMLTableCellElement>> = ({children,...props}) => <th {...props} style={{textAlign:'left', padding:'8px', borderBottom:'1px solid #eee'}}>{children}</th>;
export const TableCell: React.FC<React.TdHTMLAttributes<HTMLTableCellElement>> = ({children,...props}) => <td {...props} style={{padding:'8px', borderBottom:'1px solid #f0f0f0'}}>{children}</td>;
